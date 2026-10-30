package com.wotb.web.battledata;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import com.wotb.web.battledata.repository.BattleDataRepository;
import com.wotb.web.battledata.controller.BattleDataController;
import com.wotb.web.battledata.service.BattleDataService;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

/** Actual servlet/security/HTTP and PostgreSQL evidence, without client identity. */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"management.server.port=0", "battle-data.per-source-per-minute=1000"})
@Import(BattleDataHttpTest.TestJwt.class)
class BattleDataHttpTest {
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

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired MeterRegistry meters;
    @Autowired PlatformTransactionManager transactions;
    @Autowired BattleDataRepository repository;
    @Autowired JwtDecoder decoder;
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach void setup() {
        org.mockito.Mockito.reset(decoder);
        jdbc.execute("TRUNCATE battle_data_battle RESTART IDENTITY CASCADE");
    }

    @Test void anonymous201And204AreEmptyAndCommitMetricsMatch() throws Exception {
        final double created = count("battle_data.created");
        final double duplicate = count("battle_data.duplicate");
        final String body = BattleDataPersistenceTest.payload("101", 1, 0, 123);
        final var first = post(body);
        assertEquals(201, first.statusCode());
        assertEquals("", first.body());
        final var second = post(body);
        assertEquals(204, second.statusCode());
        assertEquals("", second.body());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM battle_data_battle", Integer.class));
        assertEquals(14, jdbc.queryForObject("SELECT count(*) FROM battle_data_vehicle", Integer.class));
        assertEquals(created + 1, count("battle_data.created"));
        assertEquals(duplicate + 1, count("battle_data.duplicate"));
        verifyNoInteractions(decoder);
    }

    @Test void malformedAndChunkedOversizedHaveCanonicalEnvelopeWithoutLoggingPayload() throws Exception {
        final var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        final var capture = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        capture.start(); logger.addAppender(capture);
        try {
            final String secret = "sensitive-player-nickname";
            final var malformed = post("{\"" + secret + "\":");
            error(malformed, 400, "INVALID_REQUEST");
            final var oversized = client.send(request().POST(HttpRequest.BodyPublishers.ofInputStream(
                    () -> new ByteArrayInputStream(new byte[16_385]))).build(), HttpResponse.BodyHandlers.ofString());
            error(oversized, 413, "FILE_TOO_LARGE");
            final var unsupported = client.send(HttpRequest.newBuilder(url()).header("Content-Type", "text/plain")
                    .POST(HttpRequest.BodyPublishers.ofString("{}" )).build(), HttpResponse.BodyHandlers.ofString());
            error(unsupported, 415, "UNSUPPORTED_MEDIA_TYPE");
            assertTrue(capture.list.stream().noneMatch(event -> event.getFormattedMessage().contains(secret)));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM battle_data_battle", Integer.class));
        } finally {
            logger.detachAppender(capture); capture.stop();
        }
    }

    @Test void securityRemainsClosedForOtherMethodsAndEndpoints() throws Exception {
        final var get = client.send(HttpRequest.newBuilder(url()).GET().build(), HttpResponse.BodyHandlers.ofString());
        error(get, 401, "AUTH_UNAUTHENTICATED");
        final var unrelated = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/not-allowed"))
                .POST(HttpRequest.BodyPublishers.ofString("{}")).build(), HttpResponse.BodyHandlers.ofString());
        error(unrelated, 401, "AUTH_UNAUTHENTICATED");
    }

    @Test void jsonSchemaIntegersAcceptExactDecimalAndExponentNumbersAndRejectFractions() throws Exception {
        final String decimals = BattleDataPersistenceTest.payload("401", 1, 2, 123)
                .replace("\"schemaVersion\":1", "\"schemaVersion\":1.0")
                .replace("\"arenaBonusType\":1", "\"arenaBonusType\":1e0")
                .replace("\"mapId\":43", "\"mapId\":43.0")
                .replace("\"winnerTeam\":2", "\"winnerTeam\":2.0")
                .replace("\"team\":1", "\"team\":1.0")
                .replace("123", "1.23e2");
        assertEquals(201, post(decimals).statusCode());
        assertEquals(201, post(BattleDataPersistenceTest.payload("402", 7, 0, 123)
                .replace("\"mapId\":43", "\"mapId\":4.3e1")).statusCode());
        for (final String number : List.of("43.5", "43.00000000000000000001", "2147483648.0")) {
            error(post(BattleDataPersistenceTest.payload("403", 1, 1, 123)
                    .replace("\"mapId\":43", "\"mapId\":" + number)), 400, "INVALID_REQUEST");
        }
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM battle_data_battle WHERE map_id=43", Integer.class));
        assertEquals(28, jdbc.queryForObject("SELECT count(*) FROM battle_data_vehicle WHERE vehicle_id=123", Integer.class));
    }

    @Test void concurrentHttpSubmissionsProduceOne201AndOther204s() throws Exception {
        final int clients = 8;
        final var barrier = new CyclicBarrier(clients);
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final List<java.util.concurrent.Future<Integer>> outcomes = new ArrayList<>();
            for (int i = 0; i < clients; i++) {
                final int vehicle = i + 1;
                outcomes.add(executor.submit(() -> {
                    barrier.await(10, TimeUnit.SECONDS);
                    return post(BattleDataPersistenceTest.payload("102", 7, vehicle % 3, vehicle)).statusCode();
                }));
            }
            int created = 0;
            for (final var outcome : outcomes) {
                final int status = outcome.get(20, TimeUnit.SECONDS);
                assertTrue(status == 201 || status == 204);
                if (status == 201) { created++; }
            }
            assertEquals(1, created);
        }
        assertEquals(14, jdbc.queryForObject("SELECT count(*) FROM battle_data_vehicle", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(DISTINCT vehicle_id) FROM battle_data_vehicle", Integer.class));
    }

    @Test void disabledAndRateLimitedHaveNoWritesAndNoSuccessfulMetrics() throws Exception {
        final var localMeters = new SimpleMeterRegistry();
        try {
            final var disabled = new BattleDataService(repository, transactions, localMeters, false, 1, 2, 1);
            final InputStream forbiddenRead = new InputStream() {
                @Override public int read() { throw new AssertionError("disabled must not read"); }
            };
            assertEquals(ApiErrorCode.SERVICE_UNAVAILABLE,
                    assertThrows(ApiException.class, () -> disabled.accept(forbiddenRead, "source")).errorCode());
            final var limited = new BattleDataService(repository, transactions, localMeters, true, 1, 2, 1);
            assertThrows(ApiException.class, () -> limited.accept(bytes("{}"), "source"));
            assertEquals(ApiErrorCode.RATE_LIMITED,
                    assertThrows(ApiException.class, () -> limited.accept(bytes("{}"), "source")).errorCode());
            assertEquals(1, localMeters.get("battle_data.rejected").tag("reason", "schema").counter().count());
            assertEquals(1, localMeters.get("battle_data.rate_limited").counter().count());
            assertEquals(0, localMeters.get("battle_data.created").counter().count());
            final var disabledHttp = MockMvcBuilders.standaloneSetup(new BattleDataController(disabled, ""))
                    .setControllerAdvice(new GlobalExceptionHandler()).build();
            disabledHttp.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/battle-data").contentType("application/json").content("{}"))
                    .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.errorCode").value("SERVICE_UNAVAILABLE"));
            final var limitedHttp = MockMvcBuilders.standaloneSetup(new BattleDataController(limited, ""))
                    .setControllerAdvice(new GlobalExceptionHandler()).build();
            limitedHttp.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/battle-data").contentType("application/json").content("{}")
                    .with(request -> { request.setRemoteAddr("source"); return request; }))
                    .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.errorCode").value("RATE_LIMITED"));
        } finally { localMeters.close(); }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM battle_data_battle", Integer.class));
    }

    @Test void rollbackNeverIncrementsCreatedOrLeaksSqlDetails() throws Exception {
        final double before = count("battle_data.created");
        jdbc.execute("ALTER TABLE battle_data_vehicle ADD CONSTRAINT private_failure CHECK (vehicle_id <> 999)");
        try {
            error(post(BattleDataPersistenceTest.payload("103", 1, 1, 999)), 500, "INTERNAL_ERROR");
            assertEquals(before, count("battle_data.created"));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM battle_data_battle", Integer.class));
        } finally { jdbc.execute("ALTER TABLE battle_data_vehicle DROP CONSTRAINT private_failure"); }
    }

    @Test void deferredCommitFailureNeverIncrementsCreated() throws Exception {
        final double before = count("battle_data.created");
        jdbc.execute("""
                CREATE FUNCTION battle_data_test_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'private-commit-detail'; END $$
                """);
        jdbc.execute("""
                CREATE CONSTRAINT TRIGGER battle_data_test_commit_failure
                AFTER INSERT ON battle_data_vehicle DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION battle_data_test_commit_failure()
                """);
        try {
            final var result = post(BattleDataPersistenceTest.payload("104", 1, 1, 123));
            error(result, 500, "INTERNAL_ERROR");
            assertTrue(!result.body().contains("private-commit-detail"));
            assertEquals(before, count("battle_data.created"));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM battle_data_battle", Integer.class));
        } finally {
            jdbc.execute("DROP TRIGGER battle_data_test_commit_failure ON battle_data_vehicle");
            jdbc.execute("DROP FUNCTION battle_data_test_commit_failure()");
        }
    }

    @Test void adminReadRequiresSiteAdminAndCannotMutate() throws Exception {
        final var admin = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("admin-token").header("alg", "none")
                .subject("admin").claim("realm_access", java.util.Map.of("roles", List.of("wotbtools-admin"))).build();
        final var user = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("user-token").header("alg", "none")
                .subject("user").claim("realm_access", java.util.Map.of("roles", List.of("wotbtools-user"))).build();
        org.mockito.Mockito.when(decoder.decode("admin-token")).thenReturn(admin);
        org.mockito.Mockito.when(decoder.decode("user-token")).thenReturn(user);
        for (final String role : List.of("HoF-admin", "tournament-admin", "content-admin")) {
            final var other = org.springframework.security.oauth2.jwt.Jwt.withTokenValue(role).header("alg", "none")
                    .subject("other").claim("realm_access", java.util.Map.of("roles", List.of(role))).build();
            org.mockito.Mockito.when(decoder.decode(role)).thenReturn(other);
        }
        for (final String path : List.of("summary", "spawn-stats", "battles", "battles/1")) {
            final var uri = URI.create("http://127.0.0.1:" + port + "/api/admin/battle-data/" + path);
            assertEquals(401, client.send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
            assertEquals(403, client.send(HttpRequest.newBuilder(uri).header("Authorization", "Bearer user-token").GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
            for (final String role : List.of("HoF-admin", "tournament-admin", "content-admin")) {
                assertEquals(403, client.send(HttpRequest.newBuilder(uri).header("Authorization", "Bearer " + role).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
            }
            assertEquals(path.equals("battles/1") ? 404 : 200,
                    client.send(HttpRequest.newBuilder(uri).header("Authorization", "Bearer admin-token").GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
            assertEquals(405, client.send(HttpRequest.newBuilder(uri).header("Authorization", "Bearer admin-token").DELETE().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        }
        assertEquals(201, post(BattleDataPersistenceTest.payload("989", 1, 0, 123)).statusCode());
        final var listUrl = URI.create("http://127.0.0.1:" + port + "/api/admin/battle-data/battles");
        final var listResponse = client.send(HttpRequest.newBuilder(listUrl).header("Authorization", "Bearer admin-token").GET().build(), HttpResponse.BodyHandlers.ofString());
        final var json = JsonMapper.builder().build().readTree(listResponse.body());
        assertEquals("989", json.get("items").get(0).get("arenaId").asString());
        assertTrue(json.get("items").get(0).get("receivedAt").isString());
        assertTrue(json.get("nextCursor").isNull());
        final var detailUrl = URI.create(listUrl + "/" + json.get("items").get(0).get("id").asString());
        final var detail = client.send(HttpRequest.newBuilder(detailUrl).header("Authorization", "Bearer admin-token").GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(14, JsonMapper.builder().build().readTree(detail.body()).get("vehicles").size());
    }

    private HttpResponse<String> post(final String body) throws Exception {
        return client.send(request().POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest.Builder request() { return HttpRequest.newBuilder(url()).header("Content-Type", "application/json"); }
    private URI url() { return URI.create("http://127.0.0.1:" + port + "/api/battle-data"); }
    private double count(final String name) { return meters.get(name).counter().count(); }
    private static InputStream bytes(final String body) { return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)); }
    private static void error(final HttpResponse<String> response, final int status, final String code) {
        assertEquals(status, response.statusCode());
        final var body = JsonMapper.builder().build().readTree(response.body());
        assertEquals(code, body.get("errorCode").asString());
        assertEquals(status, body.get("status").asInt());
        assertNotNull(body.get("id"));
    }
}
