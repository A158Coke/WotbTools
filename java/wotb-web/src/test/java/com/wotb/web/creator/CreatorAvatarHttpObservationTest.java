package com.wotb.web.creator;

import com.qcloud.cos.COSClient;
import com.wotb.web.util.CosImageStorage;
import io.micrometer.core.instrument.Timer;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/** Real servlet request: existing HTTP metrics keep their framework schema. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CreatorAvatarHttpObservationTest.FakeCos.class)
class CreatorAvatarHttpObservationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");

    @DynamicPropertySource static void properties(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
        registry.add("management.server.port", () -> "0");
    }

    @TestConfiguration
    static class FakeCos {
        @Bean COSClient testCosClient() { return mock(COSClient.class); }
        @Bean @Primary CosImageStorage testCosStorage(final COSClient client) {
            return new CosImageStorage(client, "images-1251234567", "league-broadcasts/covers/", "creator-avatars/");
        }
    }

    @LocalServerPort int port;
    @Autowired PrometheusMeterRegistry prometheus;

    @Test
    void existingHttpMetricsRemainAndDoNotCarryOperationEnrichment() throws Exception {
        final HttpResponse<String> response = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build()
                .send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/health"))
                        .timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        final String scrape = prometheus.scrape();
        assertTrue(scrape.contains("http_server_requests_seconds_count"));
        final List<Timer> timers = prometheus.find("http.server.requests").timers().stream().toList();
        assertFalse(timers.isEmpty());
        for (final Timer timer : timers) {
            assertNull(timer.getId().getTag("error_code"));
            assertNull(timer.getId().getTag("error.code"));
        }
    }
}
