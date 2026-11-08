package com.wotb.web.sitefeedback;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.sitefeedback.controller.SiteFeedbackController;
import com.wotb.web.sitefeedback.dto.SiteFeedbackCreated;
import com.wotb.web.sitefeedback.dto.SiteFeedbackPage;
import com.wotb.web.sitefeedback.service.SiteFeedbackService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SiteFeedbackHttpTest {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;

    @BeforeEach void setup() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @AfterEach void close() { context.close(); }

    @Test void authenticatedCreationAndAdminAuthorization() throws Exception {
        final var service = context.getBean(SiteFeedbackService.class);
        when(service.createFromStream(any())).thenReturn(new SiteFeedbackCreated("1", Instant.parse("2026-01-01T00:00:00Z")));
        when(service.list(eq(0), eq(25), eq(null))).thenReturn(new SiteFeedbackPage(List.of(), 0, 25, 0, 0));
        final String body = "{\"reasonCodes\":[\"BUG\"]}";
        final var admin = new SimpleGrantedAuthority("ROLE_wotbtools-admin");
        mvc.perform(post("/api/site-feedback").contentType("application/json").content(body))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/site-feedback").contentType("application/json").content(body).with(jwt()))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.id").value("1"))
                .andExpect(jsonPath("$.createdAt").value("2026-01-01T00:00:00Z"));
        mvc.perform(get("/api/admin/site-feedback")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/site-feedback").with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/site-feedback").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_content-admin"))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/site-feedback/1").with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/site-feedback/1").with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(patch("/api/admin/site-feedback/1/status").contentType("application/json")
                        .content("{\"status\":\"FIXED\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(patch("/api/admin/site-feedback/1/status").with(jwt().authorities())
                        .contentType("application/json").content("{\"status\":\"FIXED\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(patch("/api/admin/site-feedback/1/status")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_content-admin")))
                        .contentType("application/json").content("{\"status\":\"FIXED\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(patch("/api/admin/site-feedback/1/status").with(jwt().authorities(admin))
                        .contentType("application/json").content("{\"status\":\"FIXED\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/api/admin/site-feedback/1").with(jwt().authorities(admin)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/admin/site-feedback").with(jwt().authorities(admin)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isArray());
    }

    @Configuration
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class, GlobalExceptionHandler.class})
    static class TestConfig {
        @Bean JwtDecoder jwtDecoder() { return mock(JwtDecoder.class); }
        @Bean SiteFeedbackService service() { return mock(SiteFeedbackService.class); }
        @Bean SiteFeedbackController controller(final SiteFeedbackService service) {
            return new SiteFeedbackController(service);
        }
    }
}
