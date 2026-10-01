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
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.List;
import java.util.Map;

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

    /**
     * battle-playback-v2 / map-overview 已对匿名开放（Dataset-only，只消费调用方以不可猜测 jobId 引用的
     * ProcessedDataset）：匿名、已登录无角色、wotbtools-user / wotbtools-admin 均 → 2xx。
     */
    @Test
    void battlePlaybackV2AndMapOverviewArePublic() throws Exception {
        for (final String path : List.of("/api/replay/battle-playback-v2", "/api/replay/map-overview")) {
            // 匿名 → 2xx
            mvc.perform(post(path)).andExpect(status().isOk());
            // 已登录但无角色 → 2xx（不再有角色门）
            mvc.perform(post(path).with(jwt())).andExpect(status().isOk());
            // wotbtools-user / wotbtools-admin → 2xx
            mvc.perform(post(path).with(jwt().authorities(
                            new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                    .andExpect(status().isOk());
            mvc.perform(post(path).with(jwt().authorities(
                            new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                    .andExpect(status().isOk());
        }
    }

    /**
     * 批量重建 / 同步处理仍保留 wotbtools-user / wotbtools-admin 角色门（不随赛果解析一起放开）：
     * 匿名 → 401 canonical envelope；已登录无角色 → 403；wotbtools-user / wotbtools-admin → 2xx。
     */
    @Test
    void reconstructBatchAndProcessStillRequireReplayRole() throws Exception {
        for (final String path : List.of("/api/replay/reconstruct-batch", "/api/replay/process")) {
            mvc.perform(post(path))
                    .andExpect(status().isUnauthorized())
                    .andExpect(content().contentTypeCompatibleWith("application/json"))
                    .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                    .andExpect(jsonPath("$.status").value(401));
            mvc.perform(post(path).with(jwt()))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"));
            mvc.perform(post(path).with(jwt().authorities(
                            new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                    .andExpect(status().is2xxSuccessful());
            mvc.perform(post(path).with(jwt().authorities(
                            new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                    .andExpect(status().is2xxSuccessful());
        }
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
     * Replay Processing Job（POST 创建）已对匿名开放：匿名 / 已登录无角色 / 任意角色均 → 2xx。
     * 携带有效 Bearer 时 subject 照常解析（operationId 幂等分域）；匿名时 subject 为空，只是跳过幂等。
     * probe handler 无参：真实创建端点的 multipart 解析不属于安全门测试范围。
     */
    @Test
    void replayProcessingJobCreateIsPublic() throws Exception {
        final String path = "/api/replay/processing-jobs";

        // 匿名 → 2xx（probe 返回 200；真实端点返回 202）
        mvc.perform(post(path))
                .andExpect(status().is2xxSuccessful());

        // 已登录但无角色 → 2xx
        mvc.perform(post(path).with(jwt()))
                .andExpect(status().is2xxSuccessful());

        // wotbtools-user / wotbtools-admin / HoF-admin → 2xx
        for (final String role : List.of("ROLE_wotbtools-user", "ROLE_wotbtools-admin", "ROLE_HoF-admin")) {
            mvc.perform(post(path).with(jwt().authorities(new SimpleGrantedAuthority(role))))
                    .andExpect(status().is2xxSuccessful());
        }
    }

    /** GET 状态 / GET result / DELETE 取消三条端点与 POST 创建同样公开（匿名可用）。 */
    @Test
    void replayProcessingJobStatusResultAndCancelArePublic() throws Exception {
        final String statusPath = "/api/replay/processing-jobs/job-1";
        final String resultPath = "/api/replay/processing-jobs/job-1/result";

        // 匿名 → 2xx
        mvc.perform(get(statusPath)).andExpect(status().is2xxSuccessful());
        mvc.perform(get(resultPath)).andExpect(status().is2xxSuccessful());
        mvc.perform(delete(statusPath)).andExpect(status().is2xxSuccessful());

        // 已登录但无角色 → 2xx
        mvc.perform(get(statusPath).with(jwt())).andExpect(status().is2xxSuccessful());
        mvc.perform(get(resultPath).with(jwt())).andExpect(status().is2xxSuccessful());
        mvc.perform(delete(statusPath).with(jwt())).andExpect(status().is2xxSuccessful());

        // wotbtools-user / wotbtools-admin → 2xx
        for (final String role : List.of("ROLE_wotbtools-user", "ROLE_wotbtools-admin")) {
            final SimpleGrantedAuthority authority = new SimpleGrantedAuthority(role);
            mvc.perform(get(statusPath).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(get(resultPath).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(delete(statusPath).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
        }
    }

    /** /api/preview 保持公开（独立 legacy contract）；processing-jobs 同样公开（匿名可用）。 */
    @Test
    void previewAndProcessingJobsAreBothPublic() throws Exception {
        mvc.perform(get("/api/preview"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/replay/processing-jobs"))
                .andExpect(status().is2xxSuccessful());
    }

    /**
     * Replay Export Job 与 Processing Job 同级开放：Export 只消费调用方以不可猜测 processingJobId 引用的
     * {@code ProcessedDataset}，create / status / cancel / download 四条端点匿名可用。
     */
    @Test
    void replayExportJobEndpointsArePublic() throws Exception {
        final String create = "/api/replay/export-jobs";
        final String status = "/api/replay/export-jobs/job-1";
        final String download = "/api/replay/export-jobs/job-1/download";

        // 匿名 → 2xx（覆盖 create / status / cancel / download 四条端点）
        mvc.perform(post(create)).andExpect(status().is2xxSuccessful());
        mvc.perform(get(status)).andExpect(status().is2xxSuccessful());
        mvc.perform(delete(status)).andExpect(status().is2xxSuccessful());
        mvc.perform(get(download)).andExpect(status().is2xxSuccessful());

        // 已登录但无角色 → 2xx
        mvc.perform(post(create).with(jwt())).andExpect(status().is2xxSuccessful());
        mvc.perform(get(status).with(jwt())).andExpect(status().is2xxSuccessful());
        mvc.perform(delete(status).with(jwt())).andExpect(status().is2xxSuccessful());
        mvc.perform(get(download).with(jwt())).andExpect(status().is2xxSuccessful());

        // wotbtools-user / wotbtools-admin → 2xx
        for (final String role : List.of("ROLE_wotbtools-user", "ROLE_wotbtools-admin")) {
            final SimpleGrantedAuthority authority = new SimpleGrantedAuthority(role);
            mvc.perform(post(create).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(get(status).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(delete(status).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(get(download).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
        }
    }

    /** legacy /api/export 是独立 public contract；export-jobs 同样公开（匿名可用）。 */
    @Test
    void legacyExportAndExportJobsAreBothPublic() throws Exception {
        mvc.perform(get("/api/export"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/replay/export-jobs/job-1"))
                .andExpect(status().is2xxSuccessful());
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
                "/api/replay/processing-jobs/{jobId}",
                "/api/replay/processing-jobs/{jobId}/result",
                "/api/replay/export-jobs/{jobId}",
                "/api/replay/export-jobs/{jobId}/download",
                "/api/preview",
                "/api/export",
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

        @PostMapping({
                "/api/replay/battle-playback-v2",
                "/api/replay/map-overview"
        })
        String battlePlaybackV2() {
            return "ok";
        }

        /** 批量重建 / 同步处理探针：仍受 wotbtools-user / wotbtools-admin 角色门保护。 */
        @PostMapping({
                "/api/replay/reconstruct-batch",
                "/api/replay/process"
        })
        String replayRoleGatedProbe() {
            return "ok";
        }

        /**
         * Replay Processing Job 创建探针：不声明参数，避免测试依赖真实 multipart 解析
         * （真实端点返回 202 + {jobId, status, total}；此处只验证安全放行）。
         */
        @PostMapping("/api/replay/processing-jobs")
        String replayProcessingJobCreate() {
            return "ok";
        }

        @DeleteMapping("/api/replay/processing-jobs/{jobId}")
        String replayProcessingJobCancel() {
            return "ok";
        }

        /** Replay Export Job 创建探针（Dataset-only；此处只验证安全放行）。 */
        @PostMapping("/api/replay/export-jobs")
        String replayExportJobCreate() {
            return "ok";
        }

        @DeleteMapping("/api/replay/export-jobs/{jobId}")
        String replayExportJobCancel() {
            return "ok";
        }
    }
}
