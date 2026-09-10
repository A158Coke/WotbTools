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
    void boostManagerShouldOnlyAccessBoostAdminApi() throws Exception {
        final SimpleGrantedAuthority role = new SimpleGrantedAuthority("ROLE_boost-manager");

        mvc.perform(get("/api/admin/boost/probe").with(jwt().authorities(role)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/admin/users/probe").with(jwt().authorities(role)))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/other/probe").with(jwt().authorities(role)))
                .andExpect(status().isForbidden());
    }

    @Test
    void realmAccessClaimShouldBecomeSpringRole() throws Exception {
        final JwtDecoder decoder = context.getBean(JwtDecoder.class);
        final Jwt token = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("kc-user")
                .claim("realm_access", Map.of("roles", List.of("boost-manager")))
                .build();
        when(decoder.decode("token")).thenReturn(token);

        mvc.perform(get("/api/admin/boost/probe")
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

        mvc.perform(get("/api/admin/boost/probe").with(jwt().authorities(role)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/admin/users/probe").with(jwt().authorities(role)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/admin/other/probe").with(jwt().authorities(role)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/replay/analyze").with(jwt().authorities(role)))
                .andExpect(status().isOk());
    }

    @Test
    void replayAnalysisShouldAcceptUserAndAdmin() throws Exception {
        // anonymous → 401
        mvc.perform(get("/api/replay/analyze"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(header().string("X-Request-ID",
                        org.hamcrest.Matchers.not(org.hamcrest.Matchers.emptyOrNullString())));

        // wotbtools-user → 200 (new permission)
        mvc.perform(get("/api/replay/analyze").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isOk());

        // wotbtools-admin → 200 (existing permission)
        mvc.perform(get("/api/replay/analyze").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk());

        // authenticated but no allowed role → 403
        mvc.perform(get("/api/replay/analyze").with(jwt()))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"))
                .andExpect(jsonPath("$.id").isNotEmpty());

        // cancel uses the same role gate as analyze
        mvc.perform(get("/api/replay/analyze/cancel").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isOk());
        mvc.perform(get("/api/replay/analyze/cancel"))
                .andExpect(status().isUnauthorized());

        // boost-manager → 403 (not allowed)
        mvc.perform(get("/api/replay/analyze").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_boost-manager"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void battlePlaybackV2UsesReplayRoleGateAndCanonicalErrors() throws Exception {
        final String path = "/api/replay/battle-playback-v2";

        mvc.perform(post(path))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.retryable").value(false))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(jsonPath("$.timestamp").isNotEmpty());
        mvc.perform(post(path).header("X-Request-ID", "trace-playback-401"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("X-Request-ID", "trace-playback-401"))
                .andExpect(jsonPath("$.id").value("trace-playback-401"));
        mvc.perform(post(path).with(jwt()).header("X-Request-ID", "trace-playback-403"))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(header().string("X-Request-ID", "trace-playback-403"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"))
                .andExpect(jsonPath("$.status").value(403))
                .andExpect(jsonPath("$.id").value("trace-playback-403"))
                .andExpect(jsonPath("$.retryable").value(false))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(jsonPath("$.timestamp").isNotEmpty());
        mvc.perform(post(path).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isOk());
        mvc.perform(post(path).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk());
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
    void ratingV2GrayEndpointShouldRequireTheSuperAdminRole() throws Exception {
        final String path = "/api/admin/rating-v2/processing-jobs/probe";

        mvc.perform(get(path))
                .andExpect(status().isUnauthorized());
        mvc.perform(get(path).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());
        mvc.perform(get(path).with(jwt().authorities(
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
        mvc.perform(get("/api/admin/boost/probe").with(jwt().authorities(
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
     * Replay Processing Job（POST 创建）收紧为 authenticated + wotbtools-user/wotbtools-admin。
     * probe handler 无参：真实创建端点的 multipart 解析不属于安全门测试范围。
     */
    @Test
    void replayProcessingJobCreateRequiresAuthenticationAndReplayRole() throws Exception {
        final String path = "/api/replay/processing-jobs";

        // 匿名 → 401 canonical error envelope
        mvc.perform(post(path))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.retryable").value(false))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(jsonPath("$.timestamp").isNotEmpty());
        // X-Request-ID 透传到 error envelope 的 id
        mvc.perform(post(path).header("X-Request-ID", "trace-processing-create-401"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("X-Request-ID", "trace-processing-create-401"))
                .andExpect(jsonPath("$.id").value("trace-processing-create-401"));

        // 已登录但无角色 → 403
        mvc.perform(post(path).with(jwt()))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"));

        // wotbtools-user / wotbtools-admin → 2xx（probe 返回 200；真实端点返回 202）
        mvc.perform(post(path).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().is2xxSuccessful());
        mvc.perform(post(path).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().is2xxSuccessful());

        // boost-manager 不在这道门的角色集合内 → 403
        mvc.perform(post(path).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_boost-manager"))))
                .andExpect(status().isForbidden());
    }

    /** GET 状态 / GET result / DELETE 取消三条端点与 POST 创建共用同一道角色门。 */
    @Test
    void replayProcessingJobStatusResultAndCancelShareTheSameRoleGate() throws Exception {
        final String statusPath = "/api/replay/processing-jobs/job-1";
        final String resultPath = "/api/replay/processing-jobs/job-1/result";

        // 匿名 → 401
        mvc.perform(get(statusPath))
                .andExpect(status().isUnauthorized());
        mvc.perform(get(resultPath))
                .andExpect(status().isUnauthorized());
        mvc.perform(delete(statusPath))
                .andExpect(status().isUnauthorized());

        // 已登录但无角色 → 403（canonical body 在 GET 状态上校验一次即可）
        mvc.perform(get(statusPath).with(jwt()))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"))
                .andExpect(jsonPath("$.status").value(403));
        mvc.perform(get(resultPath).with(jwt()))
                .andExpect(status().isForbidden());
        mvc.perform(delete(statusPath).with(jwt()))
                .andExpect(status().isForbidden());

        // wotbtools-user → 2xx
        mvc.perform(get(statusPath).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().is2xxSuccessful());
        mvc.perform(get(resultPath).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().is2xxSuccessful());
        mvc.perform(delete(statusPath).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().is2xxSuccessful());

        // wotbtools-admin → 2xx
        mvc.perform(get(statusPath).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().is2xxSuccessful());
        mvc.perform(delete(statusPath).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().is2xxSuccessful());
    }

    /** /api/preview 保持公开（独立 legacy contract）；processing-jobs 不再随它放行，防止再次漂移。 */
    @Test
    void previewStaysPublicWhileProcessingJobsRequireLogin() throws Exception {
        mvc.perform(get("/api/preview"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/replay/processing-jobs"))
                .andExpect(status().isUnauthorized());
    }

    /**
     * Replay Export Job 与 Processing Dataset 同级鉴权（auth bypass 回归）：Export 消费的是 Processing
     * Job 的 {@code ProcessedDataset}，匿名可调用就等于绕过 {@code GET .../result} 的认证保护。
     */
    @Test
    void replayExportJobEndpointsRequireTheSameReplayRoleGate() throws Exception {
        final String create = "/api/replay/export-jobs";
        final String status = "/api/replay/export-jobs/job-1";
        final String download = "/api/replay/export-jobs/job-1/download";

        // 匿名 → 401 canonical envelope（覆盖 create / status / cancel / download 四条端点）
        mvc.perform(post(create))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.retryable").value(false))
                .andExpect(jsonPath("$.details").isMap());
        mvc.perform(get(status)).andExpect(status().isUnauthorized());
        mvc.perform(delete(status)).andExpect(status().isUnauthorized());
        mvc.perform(get(download)).andExpect(status().isUnauthorized());

        // 已登录但无角色 → 403
        mvc.perform(post(create).with(jwt()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"));
        mvc.perform(get(status).with(jwt())).andExpect(status().isForbidden());
        mvc.perform(delete(status).with(jwt())).andExpect(status().isForbidden());
        mvc.perform(get(download).with(jwt())).andExpect(status().isForbidden());

        // wotbtools-user / wotbtools-admin → 2xx
        for (final String role : List.of("ROLE_wotbtools-user", "ROLE_wotbtools-admin")) {
            final SimpleGrantedAuthority authority = new SimpleGrantedAuthority(role);
            mvc.perform(post(create).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(get(status).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(delete(status).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
            mvc.perform(get(download).with(jwt().authorities(authority))).andExpect(status().is2xxSuccessful());
        }

        // boost-manager 不在这道门的角色集合内 → 403
        mvc.perform(get(status).with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_boost-manager"))))
                .andExpect(status().isForbidden());
    }

    /** legacy /api/export 是独立 public contract：export-jobs 收紧不得把它一起绑成需登录。 */
    @Test
    void legacyExportEndpointStaysPublicWhileExportJobsRequireLogin() throws Exception {
        mvc.perform(get("/api/export"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/replay/export-jobs/job-1"))
                .andExpect(status().isUnauthorized());
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
                "/api/admin/boost/probe",
                "/api/admin/users/probe",
                "/api/admin/other/probe",
                "/api/unmatched",
                "/api/health",
                "/api/users/probe",
                "/api/replay/analyze",
                "/api/replay/analyze/cancel",
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
                "/api/admin/rating-v2/processing-jobs/probe",
                "/static-probe"
        })
        String probe() {
            return "ok";
        }

        @PostMapping("/api/replay/battle-playback-v2")
        String battlePlaybackV2() {
            return "ok";
        }

        /**
         * Replay Processing Job 创建探针：不声明参数，避免测试依赖真实 multipart 解析
         * （真实端点返回 202 + {jobId, status, total}；此处只验证安全角色门）。
         */
        @PostMapping("/api/replay/processing-jobs")
        String replayProcessingJobCreate() {
            return "ok";
        }

        @DeleteMapping("/api/replay/processing-jobs/{jobId}")
        String replayProcessingJobCancel() {
            return "ok";
        }

        /** Replay Export Job 创建探针（Dataset-only；此处只验证角色门）。 */
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
