package com.wotb.control;

import com.wotb.control.db.DatabaseProbeService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalManagementPort;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.http.HttpMethod.GET;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "management.server.port=0",
        "spring.security.oauth2.resourceserver.jwt.jwk-set-uri=http://127.0.0.1:9/unused"
})
@Import(ControlApiSecurityIntegrationTest.TestJwtDecoderConfiguration.class)
class ControlApiSecurityIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine");

    @LocalServerPort
    private int applicationPort;

    @LocalManagementPort
    private int managementPort;

    @Autowired
    private DatabaseProbeService databaseProbeService;

    private final RestTemplate restTemplate = new RestTemplate();

    @DynamicPropertySource
    static void databaseProperties(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Test
    void realPostgresSelectOneAndIndependentManagementSecuritySurfaceWork() {
        assertThat(databaseProbeService.isAvailable()).isTrue();
        assertThat(managementPort).isNotEqualTo(applicationPort);

        final ResponseEntity<String> health = restTemplate.getForEntity(
                "http://localhost:" + managementPort + "/actuator/health", String.class);
        assertThat(health.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(health.getBody()).contains("\"status\":\"UP\"");

        final ResponseEntity<String> metricsAnonymous = restTemplate.getForEntity(
                "http://localhost:" + managementPort + "/actuator/metrics", String.class);
        assertThat(metricsAnonymous.getStatusCode().value()).isIn(401, 403);

        final ResponseEntity<String> anonymous = restTemplate.getForEntity(
                "http://localhost:" + applicationPort + "/api/control/db", String.class);
        assertThat(anonymous.getStatusCode().value()).isEqualTo(401);

        final ResponseEntity<String> regularUser = restTemplate.exchange(
                "http://localhost:" + applicationPort + "/api/control/db", GET,
                bearer("user-token"), String.class);
        assertThat(regularUser.getStatusCode().value()).isEqualTo(403);

        final ResponseEntity<String> admin = restTemplate.exchange(
                "http://localhost:" + applicationPort + "/api/control/db", GET,
                bearer("admin-token"), String.class);
        assertThat(admin.getStatusCode().value()).isEqualTo(200);
        assertThat(admin.getBody()).contains("\"status\":\"UP\"");
    }

    private static HttpEntity<Void> bearer(final String token) {
        final HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return new HttpEntity<>(headers);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestJwtDecoderConfiguration {
        @Bean
        JwtDecoder jwtDecoder() {
            return token -> Jwt.withTokenValue(token)
                    .header("alg", "none")
                    .subject("control-test")
                    .claim("realm_access", Map.of("roles", token.equals("admin-token")
                            ? List.of("wotbtools-admin")
                            : List.of("wotbtools-user")))
                    .build();
        }
    }
}
