package com.wotb.web.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * RequestIdFilter 行为测试：
 * <ul>
 *   <li>单元层：MDC 设置/清理、请求头继承、未传时生成 UUID、长度限制。</li>
 *   <li>集成层：2xx / 401 / 403 响应都必须带 X-Request-ID（验证 filter 先于 Security 执行）。</li>
 * </ul>
 */
class RequestIdFilterTest {

    private AnnotationConfigWebApplicationContext context;

    @AfterEach
    void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    // ---------- 单元层 ----------

    @Test
    void generatedUuidIsSetOnResponseAndMdc() throws Exception {
        final MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/health");
        final MockHttpServletResponse response = new MockHttpServletResponse();
        final AtomicReference<String> mdcInside = new AtomicReference<>();

        final jakarta.servlet.FilterChain chain = (req, res) ->
                mdcInside.set(MDC.get(RequestIdFilter.MDC_KEY));
        new RequestIdFilter().doFilter(request, response, chain);

        final String requestId = response.getHeader(RequestIdFilter.HEADER);
        assertNotNull(requestId, "X-Request-ID must be set on response");
        assertTrue(isUuid(requestId), "generated requestId must be a UUID: " + requestId);
        assertEquals(requestId, mdcInside.get(), "MDC must carry same requestId inside the chain");
        assertNull(MDC.get(RequestIdFilter.MDC_KEY), "MDC must be cleared after the request");
    }

    @Test
    void incomingRequestIdIsInheritedAndTrimmed() throws Exception {
        final MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/health");
        request.addHeader(RequestIdFilter.HEADER, "  client-request-abc  ");
        final MockHttpServletResponse response = new MockHttpServletResponse();

        new RequestIdFilter().doFilter(request, response, new MockFilterChain());

        assertEquals("client-request-abc", response.getHeader(RequestIdFilter.HEADER),
                "incoming requestId must be inherited and trimmed");
    }

    @Test
    void overLongRequestIdIsTruncatedTo128() throws Exception {
        final String longId = "x".repeat(300);
        final MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/health");
        request.addHeader(RequestIdFilter.HEADER, longId);
        final MockHttpServletResponse response = new MockHttpServletResponse();

        new RequestIdFilter().doFilter(request, response, new MockFilterChain());

        assertEquals(128, response.getHeader(RequestIdFilter.HEADER).length(),
                "requestId must be truncated to 128 chars");
    }

    @Test
    void mdcIsClearedEvenWhenChainThrows() throws Exception {
        final MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/health");
        final MockHttpServletResponse response = new MockHttpServletResponse();

        final jakarta.servlet.FilterChain throwingChain = (req, res) -> {
            throw new IllegalStateException("downstream failure");
        };
        boolean thrown = false;
        try {
            new RequestIdFilter().doFilter(request, response, throwingChain);
        } catch (final IllegalStateException e) {
            thrown = true;
        }
        assertTrue(thrown);
        assertNull(MDC.get(RequestIdFilter.MDC_KEY), "MDC must be cleared even on failure");
    }

    private static boolean isUuid(final String s) {
        try {
            UUID.fromString(s);
            return true;
        } catch (final IllegalArgumentException e) {
            return false;
        }
    }

    // ---------- 集成层（2xx/401/403 都带 X-Request-ID） ----------

    @Test
    void publicRouteReturnsXRequestId() throws Exception {
        mvc().perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(header().string(RequestIdFilter.HEADER, org.hamcrest.Matchers.not(org.hamcrest.Matchers.emptyOrNullString())));
    }

    @Test
    void unauthorizedReturnsXRequestId() throws Exception {
        mvc().perform(get("/api/users/probe"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(RequestIdFilter.HEADER, org.hamcrest.Matchers.not(org.hamcrest.Matchers.emptyOrNullString())));
    }

    @Test
    void forbiddenReturnsXRequestId() throws Exception {
        mvc().perform(get("/api/admin/users/probe")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden())
                .andExpect(header().string(RequestIdFilter.HEADER, org.hamcrest.Matchers.not(org.hamcrest.Matchers.emptyOrNullString())));
    }

    @Test
    void inheritedRequestIdSurvivesSecurityDenial() throws Exception {
        mvc().perform(get("/api/users/probe")
                        .header(RequestIdFilter.HEADER, "trace-inherit-42"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(RequestIdFilter.HEADER, "trace-inherit-42"));
    }

    private MockMvc mvc() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        return MockMvcBuilders.webAppContextSetup(context)
                .addFilters(new RequestIdFilter())
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @Configuration
    @EnableWebMvc
    @Import(SecurityConfig.class)
    static class TestConfig {

        @Bean
        JwtDecoder jwtDecoder() {
            return mock(JwtDecoder.class);
        }

        @Bean
        ProbeController probeController() {
            return new ProbeController();
        }
    }

    @RestController
    static class ProbeController {

        @GetMapping({"/api/health", "/api/users/probe", "/api/admin/users/probe"})
        String probe() {
            return "ok";
        }
    }
}
