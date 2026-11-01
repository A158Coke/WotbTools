package com.wotb.web.sitefeedback;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@Import(SiteFeedbackIntegrationTest.TestJwt.class)
class SiteFeedbackIntegrationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only")
            .withCreateContainerCmdModifier(command -> command.getHostConfig().withPortBindings(
                    new PortBinding(Ports.Binding.bindIp("127.0.0.1"), new ExposedPort(5432))));

    @DynamicPropertySource static void properties(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
        registry.add("wotb.broadcast.cos.bucket", () -> "");
        registry.add("wotb.tournament.recognition-signing-key", () -> "integration-only-32-byte-signing-secret");
    }

    @TestConfiguration static class TestJwt {
        @Bean JwtDecoder testJwtDecoder() { return mock(JwtDecoder.class); }
    }

    @Autowired WebApplicationContext context;
    @Autowired JdbcTemplate jdbc;
    private MockMvc mvc;

    @BeforeEach void setup() {
        jdbc.execute("TRUNCATE site_feedback RESTART IDENTITY");
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test void authenticatedFeedbackRoundTripsThroughDatabaseAndAdminSecurity() throws Exception {
        final var admin = new SimpleGrantedAuthority("ROLE_wotbtools-admin");
        final String body = "{\"reasonCodes\":[\"BUG\"],\"feedbackText\":\"note\",\"pageView\":\"hof\"}";
        final String result = mvc.perform(post("/api/site-feedback").with(jwt()).contentType("application/json").content(body))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.createdAt").isString())
                .andReturn().getResponse().getContentAsString();
        final String id = JsonMapper.builder().build().readTree(result).get("id").asString();
        mvc.perform(get("/api/admin/site-feedback").with(jwt().authorities()))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/site-feedback?reason=BUG&size=1").with(jwt().authorities(admin)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[0].pageView").value("hof"));
        mvc.perform(get("/api/admin/site-feedback?reason=FACT_ERROR").with(jwt().authorities(admin)))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/admin/site-feedback?size=101").with(jwt().authorities(admin)))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/admin/site-feedback/" + id).with(jwt().authorities(admin)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.feedbackText").value("note"));
        mvc.perform(delete("/api/admin/site-feedback/" + id).with(jwt().authorities(admin)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/admin/site-feedback/" + id).with(jwt().authorities(admin)))
                .andExpect(status().isNotFound());
    }

    @Test void malformedFeedbackDoesNotLeakBodyIntoLogs() throws Exception {
        final var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        final var capture = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        capture.start(); logger.addAppender(capture);
        try {
            final String secret = "private-feedback-unique-marker";
            mvc.perform(post("/api/site-feedback").with(jwt()).contentType("application/json")
                    .content("{\"feedbackText\":\"" + secret + "\",\"reasonCodes\":[],\"pageView\":\"Bad View\"}"))
                    .andExpect(status().isBadRequest());
            assertTrue(capture.list.stream().noneMatch(event -> event.getFormattedMessage().contains(secret)));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM site_feedback", Integer.class));
        } finally {
            logger.detachAppender(capture); capture.stop();
        }
    }
}
