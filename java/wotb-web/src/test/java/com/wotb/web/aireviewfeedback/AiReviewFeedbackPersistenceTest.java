package com.wotb.web.aireviewfeedback;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import com.wotb.web.aireviewfeedback.dto.FeedbackReason;
import com.wotb.web.aireviewfeedback.dto.FeedbackStatus;
import com.wotb.web.aireviewfeedback.repository.AiReviewFeedbackRepository;
import com.wotb.web.aireviewfeedback.service.AiReviewFeedbackService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.concurrent.Executors;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Testcontainers
class AiReviewFeedbackPersistenceTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only")
            .withCreateContainerCmdModifier(command -> command.getHostConfig().withPortBindings(
                    new PortBinding(Ports.Binding.bindIp("127.0.0.1"), new ExposedPort(5432))));
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private AiReviewFeedbackRepository repository;
    private AiReviewFeedbackService service;
    private JdbcTemplate jdbc;

    @BeforeEach void setup() throws Exception {
        final var ds = new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(ds);
        jdbc.execute("DROP TABLE IF EXISTS ai_review_feedback");
        jdbc.execute("DROP TABLE IF EXISTS site_feedback");
        try (final var connection = ds.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V46__create_ai_review_feedback.sql"));
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V48__create_site_feedback.sql"));
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V49__add_feedback_status.sql"));
        }
        repository = new AiReviewFeedbackRepository(jdbc);
        service = new AiReviewFeedbackService(repository);
    }

    @Test void independentSubmissionsFilterPageAndDelete() {
        final var first = service.create(JSON.readTree("""
                {"reasonCodes":["FACT_ERROR"],"feedbackText":"  内容  ","aiResponseText":"回复\\nfooter","model":null}
                """));
        final var second = service.create(JSON.readTree("""
                {"reasonCodes":["FACT_ERROR"],"feedbackText":"  内容  ","aiResponseText":"回复\\nfooter","model":null}
                """));
        assertNotEquals(first.id(), second.id());
        assertNotNull(first.createdAt());
        assertEquals("回复\nfooter", service.get(first.id()).aiResponseText());
        assertEquals("  内容  ", service.get(first.id()).feedbackText());
        assertEquals(List.of(FeedbackReason.FACT_ERROR), service.get(first.id()).reasonCodes());
        assertEquals(2, service.list(0, 1, "FACT_ERROR").totalItems());
        assertEquals(second.id(), service.list(0, 1, "FACT_ERROR").items().getFirst().id());
        assertEquals(first.id(), service.list(1, 1, "FACT_ERROR").items().getFirst().id());
        assertEquals(0, service.list(0, 25, "OTHER").totalItems());
        assertNotNull(jdbc.queryForList("EXPLAIN SELECT id FROM ai_review_feedback WHERE reason_codes @> '[\"FACT_ERROR\"]'::jsonb"));
        service.delete(first.id());
        assertThrows(ApiException.class, () -> service.get(first.id()));
    }

    @Test void validateEmptyInvalidAndDuplicateReasons() {
        assertThrows(ApiException.class, () -> service.create(JSON.readTree("""
                {"reasonCodes":[],"feedbackText":"  ","aiResponseText":"ok"}
                """)));
        assertThrows(ApiException.class, () -> service.create(JSON.readTree("""
                {"reasonCodes":["INVALID"],"aiResponseText":"ok"}
                """)));
        assertThrows(ApiException.class, () -> service.create(JSON.readTree("""
                {"reasonCodes":["OTHER","OTHER"],"aiResponseText":"ok"}
                """)));
        assertNotNull(service.create(JSON.readTree("""
                {"reasonCodes":[],"feedbackText":"text","aiResponseText":"ok"}
                """)));
        assertThrows(ApiException.class, () -> service.create(JSON.readTree("""
                {"reasonCodes":["OTHER"],"aiResponseText":"ok","createdAt":"2000-01-01T00:00:00Z"}
                """)));
        assertThrows(ApiException.class, () -> service.create(JSON.readTree(
                "{\"reasonCodes\":[\"OTHER\"],\"aiResponseText\":\"bad\\u0000text\"}")));
        assertThrows(ApiException.class, () -> service.create(JSON.readTree(
                "{\"reasonCodes\":[\"OTHER\"],\"aiResponseText\":\"" + "a".repeat(200001) + "\"}")));
        assertNotNull(service.create(JSON.readTree(
                "{\"reasonCodes\":[\"OTHER\"],\"aiResponseText\":\"" + "😀".repeat(200000) + "\"}")));
    }

    @Test void concurrentDuplicatesSurviveAndSameTimeUsesIdOrder() throws Exception {
        final var request = JSON.readTree("{\"reasonCodes\":[\"OTHER\"],\"aiResponseText\":\"same\"}");
        try (final var workers = Executors.newFixedThreadPool(2)) {
            final var a = workers.submit(() -> service.create(request));
            final var b = workers.submit(() -> service.create(request));
            final long first = Long.parseLong(a.get().id());
            final long second = Long.parseLong(b.get().id());
            assertNotEquals(first, second);
            jdbc.update("UPDATE ai_review_feedback SET created_at = '2026-01-01T00:00:00Z'");
            assertEquals(Long.toString(Math.max(first, second)), service.list(0, 1, null).items().getFirst().id());
            assertEquals(Long.toString(Math.min(first, second)), service.list(1, 1, null).items().getFirst().id());
        }
    }

    @Test void rejectsMalformedDuplicateAndOversizedTransport() {
        for (final String body : List.of("{", "{\"reasonCodes\":[],\"reasonCodes\":[\"OTHER\"],\"aiResponseText\":\"ok\"}")) {
            assertThrows(ApiException.class, () -> service.createFromStream(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))));
        }
        assertThrows(ApiException.class, () -> service.createFromStream(new ByteArrayInputStream(new byte[3 * 1024 * 1024 + 1])));
    }

    @Test void defaultsToPendingAndPersistsStatusChanges() {
        final var created = service.create(JSON.readTree("""
                {"reasonCodes":["OTHER"],"aiResponseText":"reply"}
                """));
        assertEquals(FeedbackStatus.PENDING, service.get(created.id()).status());
        final long id = Long.parseLong(created.id());

        service.updateStatus(created.id(), stream("{\"status\":\"FIXED\"}"));
        assertEquals(FeedbackStatus.FIXED, service.get(created.id()).status());
        assertEquals(FeedbackStatus.FIXED, service.list(0, 25, null).items().getFirst().status());
        assertEquals("FIXED", jdbc.queryForObject("SELECT status FROM ai_review_feedback WHERE id = ?", String.class, id));

        service.updateStatus(created.id(), stream("{\"status\":\"PENDING\"}"));
        assertEquals(FeedbackStatus.PENDING, service.get(created.id()).status());
        assertEquals("PENDING", jdbc.queryForObject("SELECT status FROM ai_review_feedback WHERE id = ?", String.class, id));
    }

    @Test void rejectsInvalidStatusUpdatesAndMissingRecords() {
        final var created = service.create(JSON.readTree("""
                {"reasonCodes":["OTHER"],"aiResponseText":"reply"}
                """));
        for (final String body : List.of("", "{}", "{\"status\":null}", "{\"status\":1}",
                "{\"status\":\"DONE\"}", "{\"status\":\"pending\"}",
                "{\"status\":\"FIXED\",\"extra\":true}", "{\"status\":\"FIXED\",\"status\":\"PENDING\"}", "{")) {
            final ApiException failure = assertThrows(ApiException.class,
                    () -> service.updateStatus(created.id(), stream(body)), body);
            assertEquals(ApiErrorCode.INVALID_REQUEST, failure.errorCode(), body);
        }
        assertEquals(FeedbackStatus.PENDING, service.get(created.id()).status());

        for (final String id : List.of("0", "abc")) {
            final ApiException failure = assertThrows(ApiException.class,
                    () -> service.updateStatus(id, stream("{\"status\":\"FIXED\"}")), id);
            assertEquals(ApiErrorCode.INVALID_REQUEST, failure.errorCode(), id);
        }
        final ApiException missing = assertThrows(ApiException.class,
                () -> service.updateStatus("999999999", stream("{\"status\":\"FIXED\"}")));
        assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND, missing.errorCode());

        service.delete(created.id());
        final ApiException deleted = assertThrows(ApiException.class,
                () -> service.updateStatus(created.id(), stream("{\"status\":\"FIXED\"}")));
        assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND, deleted.errorCode());
        final ApiException oversized = assertThrows(ApiException.class,
                () -> service.updateStatus(created.id(), new ByteArrayInputStream(new byte[3 * 1024 * 1024 + 1])));
        assertEquals(ApiErrorCode.INVALID_REQUEST, oversized.errorCode());
    }

    private static ByteArrayInputStream stream(final String body) {
        return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
    }
}
