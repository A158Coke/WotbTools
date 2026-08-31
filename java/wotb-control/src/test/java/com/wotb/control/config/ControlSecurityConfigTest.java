package com.wotb.control.config;

import com.wotb.control.db.DatabaseProbeController;
import com.wotb.control.db.DatabaseProbeService;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ControlSecurityConfigTest {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private DatabaseProbeService probeService;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        probeService = context.getBean(DatabaseProbeService.class);
        mvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @AfterEach
    void tearDown() {
        context.close();
    }

    @Test
    void controlProbeRequiresAdminRole() throws Exception {
        mvc.perform(get("/api/control/db"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/control/db").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());
        when(probeService.isAvailable()).thenReturn(true);

        mvc.perform(get("/api/control/db").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void realmAccessRolesMapToAdminAuthority() throws Exception {
        final JwtDecoder decoder = context.getBean(JwtDecoder.class);
        final Jwt token = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("control-admin")
                .claim("realm_access", Map.of("roles", List.of("wotbtools-admin")))
                .build();
        when(decoder.decode("token")).thenReturn(token);
        when(probeService.isAvailable()).thenReturn(true);

        mvc.perform(get("/api/control/db").header("Authorization", "Bearer token"))
                .andExpect(status().isOk());
    }

    @Test
    void healthSurfaceIsPublicButUnknownRoutesAreDenied() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
        mvc.perform(get("/unclassified").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isForbidden());
    }

    @Configuration
    @EnableWebMvc
    @Import(ControlSecurityConfig.class)
    static class TestConfig {
        @Bean
        JwtDecoder jwtDecoder() {
            return mock(JwtDecoder.class);
        }

        @Bean
        DatabaseProbeService databaseProbeService() {
            return mock(DatabaseProbeService.class);
        }

        @Bean
        DatabaseProbeController databaseProbeController(final DatabaseProbeService service) {
            return new DatabaseProbeController(service);
        }

        @Bean
        HealthProbeController healthProbeController() {
            return new HealthProbeController();
        }

        @Bean
        DeniedProbeController deniedProbeController() {
            return new DeniedProbeController();
        }
    }

    @RestController
    static class HealthProbeController {
        @GetMapping("/actuator/health")
        String health() {
            return "UP";
        }
    }

    @RestController
    static class DeniedProbeController {
        @GetMapping("/unclassified")
        String unclassified() {
            return "must not be reachable";
        }
    }
}
