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

    @Test
    void tournamentRealmRoleOnlyGrantsTournamentManagement() throws Exception {
        final JwtDecoder decoder = context.getBean(JwtDecoder.class);
        final Jwt token = Jwt.withTokenValue("tournament-token").header("alg", "none").subject("league-admin")
                .claim("realm_access", Map.of("roles", List.of("tournament-admin"))).build();
        when(decoder.decode("tournament-token")).thenReturn(token);
        mvc.perform(get("/api/admin/tournaments/probe").header("Authorization", "Bearer tournament-token"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/admin/tournaments").header("Authorization", "Bearer tournament-token"))
                .andExpect(status().isOk());
        for (final String path : List.of("/api/admin/users/probe", "/api/admin/hof/probe", "/api/admin/other/probe")) {
            mvc.perform(get(path).header("Authorization", "Bearer tournament-token"))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get("/api/admin/tournaments/probe")).andExpect(status().isUnauthorized());
        for (final String role : List.of("HoF-admin", "wotbtools-user", "wotbtools-admin", "content-admin")) {
            mvc.perform(get("/api/admin/tournaments/probe").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get("/api/admin/tournaments/probe").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/tournaments/probe").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"), new SimpleGrantedAuthority("ROLE_tournament-admin"))))
                .andExpect(status().isOk());
    }

    @Test
    void contentRealmRoleOnlyGrantsContentManagement() throws Exception {
        final JwtDecoder decoder = context.getBean(JwtDecoder.class);
        final Jwt token = Jwt.withTokenValue("content-token").header("alg", "none").subject("content-admin")
                .claim("realm_access", Map.of("roles", List.of("content-admin"))).build();
        when(decoder.decode("content-token")).thenReturn(token);

        for (final String path : List.of("/api/admin/recommendations/probe")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
            mvc.perform(get(path).header("Authorization", "Bearer content-token")).andExpect(status().isOk());
            for (final String role : List.of("wotbtools-user", "HoF-admin", "tournament-admin", "wotbtools-admin")) {
                mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role))))
                        .andExpect(status().isForbidden());
            }
            mvc.perform(get(path).with(jwt().authorities(
                            new SimpleGrantedAuthority("ROLE_wotbtools-admin"),
                            new SimpleGrantedAuthority("ROLE_content-admin"))))
                    .andExpect(status().isOk());
        }

        for (final String path : List.of("/api/admin/tournaments/probe", "/api/admin/hof/probe",
                "/api/admin/users/probe", "/api/admin/other/probe", "/api/admin/creators/probe")) {
            mvc.perform(get(path).header("Authorization", "Bearer content-token")).andExpect(status().isForbidden());
        }
    }

    @Test
    void removedAiAnalyzeEndpointsFallThroughToDefaultApiDenyAll() throws Exception {
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
        mvc.perform(get("/api/admin/users/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());

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
        mvc.perform(get("/api/hof/upload"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/hof/1/replay"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/hof/upload").with(jwt()))
                .andExpect(status().isOk());
        mvc.perform(get("/api/hof/1/replay").with(jwt()))
                .andExpect(status().isOk());
        mvc.perform(get("/api/hof"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/hof/vehicle-options"))
                .andExpect(status().isOk());
    }

    @Test
    void hofAdminRoleGatesAreExact() throws Exception {
        mvc.perform(get("/api/admin/hof/probe"))
                .andExpect(status().isUnauthorized());
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
        mvc.perform(get("/api/admin/hof/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());
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
    void telemetryAllowsAnonymousButRejectsInvalidBearer() throws Exception {
        mvc.perform(post(ApiPaths.OBSERVABILITY_EVENTS)).andExpect(status().isOk());
        final JwtDecoder decoder = context.getBean(JwtDecoder.class);
        when(decoder.decode("invalid-telemetry-token")).thenThrow(new BadJwtException("invalid"));
        mvc.perform(post(ApiPaths.OBSERVABILITY_EVENTS).header("Authorization", "Bearer invalid-telemetry-token"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get(ApiPaths.OBSERVABILITY_EVENTS).with(jwt())).andExpect(status().isForbidden());
    }

    @Test
    void userApiShouldRequireAuthentication() throws Exception {
        mvc.perform(get("/api/users/probe"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/users/probe").with(jwt()))
                .andExpect(status().isOk());
    }

    @Test
    void battleDataOnlyAllowsExactAnonymousPost() throws Exception {
        mvc.perform(post(ApiPaths.BATTLE_DATA)).andExpect(status().isOk());
        mvc.perform(get(ApiPaths.BATTLE_DATA).with(jwt())).andExpect(status().isForbidden());
        mvc.perform(post(ApiPaths.BATTLE_DATA + "/extra").with(jwt())).andExpect(status().isForbidden());
    }

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
                "/api/admin/tournaments/probe",
                "/api/admin/recommendations/probe",
                "/static-probe"
        })
        String probe() {
            return "ok";
        }

        @PostMapping(ApiPaths.OBSERVABILITY_EVENTS)
        String telemetry() { return "ok"; }

        @PostMapping(ApiPaths.BATTLE_DATA)
        String battleData() { return "ok"; }

        @PostMapping("/api/admin/tournaments")
        String tournamentCreate() { return "ok"; }

        @PostMapping("/api/replay/processing-jobs")
        String replayProcessingJobCreate() {
            return "ok";
        }

        @DeleteMapping("/api/replay/export-jobs/{jobId}")
        String replayExportJobCancel() {
            return "ok";
        }
    }
}
