package com.wotb.web.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SecurityConfigTest {

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @AfterEach
    void tearDown() {
        context.close();
    }

    @Test
    void realmAccessClaimShouldBecomeSpringRole() throws Exception {
        final JwtDecoder decoder = context.getBean(JwtDecoder.class);
        final Jwt token = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("kc-user")
                .claim("realm_access", Map.of("roles", List.of("wotbtools-admin")))
                .build();
        when(decoder.decode("token")).thenReturn(token);

        mvc.perform(get("/api/admin/users/probe")
                        .header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
    }

    @Test
    void invalidBearerTokenReturnsCanonicalUnauthorizedBody() throws Exception {
        final JwtDecoder decoder = context.getBean(JwtDecoder.class);
        when(decoder.decode("invalid-token")).thenThrow(new BadJwtException("invalid token"));

        mvc.perform(get("/api/users/probe")
                        .header("Authorization", "Bearer invalid-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.details").isMap());
    }

    @Test
    void adminShouldAccessAllAdminApis() throws Exception {
        final SimpleGrantedAuthority role = new SimpleGrantedAuthority("ROLE_wotbtools-admin");

        mvc.perform(get("/api/admin/users/probe").with(jwt().authorities(role)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/admin/other/probe").with(jwt().authorities(role)))
                .andExpect(status().isOk());
    }

    /**
     * AI Review 已迁出 wotb-web（独立 ai-service）：{@code /api/replay/analyze} 与其 cancel
     * 端点不再有专属安全规则，也不再有专属角色门，落回「未显式声明的 API 默认拒绝」
     * （anonymous → 401 canonical envelope；任何已认证身份 → 403）。
     */
    @Test
    void removedAiAnalyzeEndpointsFallThroughToDefaultApiDenyAll() throws Exception {
        // anonymous → 401 canonical envelope
        mvc.perform(get("/api/replay/analyze"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(header().string("X-Request-ID",
                        org.hamcrest.Matchers.not(org.hamcrest.Matchers.emptyOrNullString())));
        mvc.perform(get("/api/replay/analyze/cancel"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"));

        // 已认证（含 wotbtools-user / wotbtools-admin / HoF-admin）→ 403，不再有 analyze 角色门
        for (final String role : List.of("ROLE_wotbtools-user", "ROLE_wotbtools-admin", "ROLE_HoF-admin")) {
            mvc.perform(get("/api/replay/analyze").with(jwt().authorities(
                            new SimpleGrantedAuthority(role))))
                    .andExpect(status().isForbidden())
                    .andExpect(content().contentTypeCompatibleWith("application/json"))
                    .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"))
                    .andExpect(jsonPath("$.id").isNotEmpty());
            mvc.perform(get("/api/replay/analyze/cancel").with(jwt().authorities(
                            new SimpleGrantedAuthority(role))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get("/api/replay/analyze").with(jwt()))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminUsersShouldStillRequireAdminRole() throws Exception {
        // wotbtools-user → 403 for /api/admin/users
        mvc.perform(get("/api/admin/users/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());

        // wotbtools-admin → 200 for /api/admin/users
        mvc.perform(get("/api/admin/users/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk());
    }

    @Test
    void unmatchedApiShouldBeDeniedEvenWhenAuthenticated() throws Exception {
        final SimpleGrantedAuthority role = new SimpleGrantedAuthority("ROLE_wotbtools-admin");

        mvc.perform(get("/api/unmatched").with(jwt().authorities(role)))
                .andExpect(status().isForbidden());
    }

    @Test
    void hofUploadAndDownloadRequireLoginWhileQueryStaysPublic() throws Exception {
        // 匿名 → 401（上传/下载需登录）
        mvc.perform(get("/api/hof/upload"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/hof/1/replay"))
                .andExpect(status().isUnauthorized());
        // 任意已登录用户 → 200（filter 放行，probe 返回 ok）
        mvc.perform(get("/api/hof/upload").with(jwt()))
                .andExpect(status().isOk());
        mvc.perform(get("/api/hof/1/replay").with(jwt()))
                .andExpect(status().isOk());
        // 名人堂查询保持公开
        mvc.perform(get("/api/hof"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/hof/vehicle-options"))
                .andExpect(status().isOk());
    }

    /** HoF-admin 只管理名人堂；wotbtools-admin 拥有全部 admin 权限。 */
    @Test
    void hofAdminRoleGatesAreExact() throws Exception {
        // anonymous → 401
        mvc.perform(get("/api/admin/hof/probe"))
                .andExpect(status().isUnauthorized());
        // HoF-admin → 200（/api/admin/hof/**），其他 admin 域 403
        mvc.perform(get("/api/admin/hof/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                .andExpect(status().isOk());
        mvc.perform(get("/api/admin/hof/audit").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                .andExpect(status().isOk());
        mvc.perform(get("/api/admin/users/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/other/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                .andExpect(status().isForbidden());
        // wotbtools-user → 403
        mvc.perform(get("/api/admin/hof/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());
        // wotbtools-admin → 200（super admin 拥有 HoF 权限）
        mvc.perform(get("/api/admin/hof/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk());
    }

    @Test
    void publicAndStaticRoutesShouldRemainPublic() throws Exception {
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk());
        mvc.perform(get("/static-probe"))
                .andExpect(status().isOk());
    }

    @Test
    void userApiShouldRequireAuthentication() throws Exception {
        mvc.perform(get("/api/users/probe"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/users/probe").with(jwt()))
                .andExpect(status().isOk());
    }

    /**
     * 服务器没有 parser：preview / export / columns、Processing Job、Export Job、playback-v2 /
     * map-overview、reconstruct-batch / process 端点全部删除，不再有专属安全规则，落回
     * 「未显式声明的 API 默认拒绝」（anonymous → 401 canonical envelope；任何已认证身份 → 403）。
     * 每种 HTTP method 只留一条代表路径（GET / POST / DELETE）；ProbeController 仍挂着这些
     * 路径，证明拒绝来自安全层而不是缺少 handler。
     */
    @Test
    void removedReplayProcessingEndpointsFallThroughToDefaultApiDenyAll() throws Exception {
        final List<Supplier<MockHttpServletRequestBuilder>> requests = List.of(
                () -> get("/api/columns"),
                () -> post("/api/replay/processing-jobs"),
                () -> delete("/api/replay/export-jobs/job-1"));
        for (final Supplier<MockHttpServletRequestBuilder> request : requests) {
            mvc.perform(request.get())
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"));
        }
        for (final String role : List.of("ROLE_wotbtools-user", "ROLE_wotbtools-admin", "ROLE_HoF-admin")) {
            for (final Supplier<MockHttpServletRequestBuilder> request : requests) {
                mvc.perform(request.get().with(jwt().authorities(new SimpleGrantedAuthority(role))))
                        .andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"));
            }
        }
    }

    @Configuration
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class})
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

        @GetMapping({
                "/api/admin/users/probe",
                "/api/admin/other/probe",
                "/api/unmatched",
                "/api/health",
                "/api/users/probe",
                "/api/columns",
                "/api/hof/upload",
                "/api/hof/1/replay",
                "/api/hof",
                "/api/hof/vehicle-options",
                "/api/admin/hof/probe",
                "/api/admin/hof/audit",
                "/static-probe"
        })
        String probe() {
            return "ok";
        }

        /** 已删除的 Replay Processing Job 创建端点探针（只用于证明默认拒绝）。 */
        @PostMapping("/api/replay/processing-jobs")
        String replayProcessingJobCreate() {
            return "ok";
        }

        /** 已删除的 Replay Export Job 取消端点探针（只用于证明默认拒绝）。 */
        @DeleteMapping("/api/replay/export-jobs/{jobId}")
        String replayExportJobCancel() {
            return "ok";
        }
    }
}
