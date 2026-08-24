package com.wotb.web.mark3.config;

import com.wotb.web.config.SecurityConfig;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import static org.mockito.Mockito.mock;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** SecurityConfig regression: leaderboard is public; submission/user/admin routes retain their proper gates. */
class Mark3SecurityContractTest {

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @AfterEach
    void tearDown() {
        context.close();
    }

    @Test
    void publicLeaderboardAndProtectedSubmissionUserAndAdminRoutesAreSeparated() throws Exception {
        mvc.perform(get("/api/hof/mark3")).andExpect(status().isOk());
        mvc.perform(get("/api/hof/mark3/submissions")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/hof/mark3/submissions").with(jwt())).andExpect(status().isOk());
        mvc.perform(get("/api/users/mark3/status")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/users/mark3/status").with(jwt())).andExpect(status().isOk());
        mvc.perform(get("/api/admin/hof/mark3/submissions")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/hof/mark3/submissions").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                .andExpect(status().isOk());
        mvc.perform(get("/api/admin/hof/mark3/submissions").with(jwt())).andExpect(status().isForbidden());
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
                "/api/hof/mark3",
                "/api/hof/mark3/submissions",
                "/api/users/mark3/status",
                "/api/admin/hof/mark3/submissions"
        })
        String probe() {
            return "ok";
        }
    }
}
