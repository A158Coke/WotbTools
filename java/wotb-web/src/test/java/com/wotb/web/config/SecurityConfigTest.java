package com.wotb.web.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
                .andExpect(status().isUnauthorized());

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
                .andExpect(status().isForbidden());

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
    }

    /**
     * HoF-admin 只管理名人堂；wotbtools-admin 拥有全部 admin 权限。
     */
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

        @GetMapping({
                "/api/admin/boost/probe",
                "/api/admin/users/probe",
                "/api/admin/other/probe",
                "/api/unmatched",
                "/api/health",
                "/api/users/probe",
                "/api/replay/analyze",
                "/api/replay/analyze/cancel",
                "/api/hof/upload",
                "/api/hof/1/replay",
                "/api/hof",
                "/api/admin/hof/probe",
                "/api/admin/hof/audit",
                "/static-probe"
        })
        String probe() {
            return "ok";
        }
    }
}