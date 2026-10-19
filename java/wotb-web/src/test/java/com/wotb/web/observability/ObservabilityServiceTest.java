package com.wotb.web.observability;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wotb.web.observability.service.ObservabilityService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ObservabilityServiceTest {
    private final Clock clock = mock(Clock.class);
    private final ObservabilityService service = new ObservabilityService(JsonMapper.builder().build(),
            "test-only-key-with-at-least-32-bytes", clock);
    private final Logger logger = (Logger) LoggerFactory.getLogger(ObservabilityService.class);
    private Level previousLevel;
    private Instant now;

    @BeforeEach
    void setUp() {
        now = Instant.now();
        when(clock.instant()).thenReturn(now);
        when(clock.millis()).thenReturn(now.toEpochMilli());
        previousLevel = logger.getLevel();
        logger.setLevel(Level.OFF);
    }

    @AfterEach
    void tearDown() {
        logger.setLevel(previousLevel);
    }

    @Test
    void acceptsAnonymousFeatureAndAllParseOutcomes() {
        service.accept(batch(event("feature_open", "")), null, "192.0.2.1");
        for (final String outcome : new String[]{"start", "success", "failure", "cancelled"}) {
            service.accept(batch(event("replay_parse", ",\"operation_id\":\"" + UUID.randomUUID()
                    + "\",\"outcome\":\"" + outcome + "\"")), null, "192.0.2.1");
        }
    }

    @Test
    void androidDownloadClickMarkerCoexistsWithLegacyPageOpenDuringRollout() {
        service.accept(batch(downloadClick()), null, "192.0.2.1");

        final String legacyPageOpen = downloadClick().replaceFirst(",\\\"operation_id\\\":\\\"[^\\\"]+\\\"", "");
        service.accept(batch(legacyPageOpen), null, "192.0.2.1");

        final String unrelatedFeatureWithMarker = event("feature_open", ",\"operation_id\":\"" + UUID.randomUUID() + "\"");
        rejects(HttpStatus.BAD_REQUEST, batch(unrelatedFeatureWithMarker));

        final String clickWithOutcome = downloadClick().replace("}", ",\"outcome\":\"start\"}");
        rejects(HttpStatus.BAD_REQUEST, batch(clickWithOutcome));
    }

    @Test
    void activeUserRequiresVerifiedSubjectAndConfiguredKey() {
        rejects(HttpStatus.UNAUTHORIZED, batch(event("active_user", "")));
        final Jwt jwt = Jwt.withTokenValue("secret-token").header("alg", "none").subject("private-user").build();
        final ObservabilityService disabled = new ObservabilityService(JsonMapper.builder().build(), "");
        disabled.accept(batch(event("feature_open", "")), jwt, "192.0.2.1");
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows(ResponseStatusException.class,
                () -> disabled.accept(batch(event("active_user", "")), jwt, "192.0.2.1")).getStatusCode());
    }

    @Test
    void hashesAuthenticatedSubjectWithoutLeakingIdentityOrCredential() {
        logger.setLevel(Level.INFO);
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            final Jwt jwt = Jwt.withTokenValue("secret-token").header("alg", "none").subject("private-user").build();
            service.accept(batch(event("active_user", "")), jwt, "192.0.2.123");
            service.accept(batch(event("feature_open", "")), null, "192.0.2.123");
            final String line = appender.list.getFirst().getFormattedMessage();
            assertTrue(line.matches(".*account_hash=[a-f0-9]{64}$"));
            assertFalse(line.contains("private-user"));
            assertFalse(line.contains("secret-token"));
            for (final ILoggingEvent logged : appender.list) {
                assertFalse(logged.getFormattedMessage().contains("192.0.2.123"));
                assertFalse(logged.getFormattedMessage().contains("client_source"));
            }
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void rejectsUnknownIdentityFieldsArbitraryErrorsBadTimesAndInvalidEnums() {
        rejects(HttpStatus.BAD_REQUEST, batch(event("feature_open", ",\"account_id\":\"forged\"")));
        rejects(HttpStatus.BAD_REQUEST, batch(event("feature_open", ",\"error_code\":\"secret stack\"")));
        rejects(HttpStatus.BAD_REQUEST, batch(event("other", "")));
        rejects(HttpStatus.BAD_REQUEST, batch(event("replay_parse", "")));
        rejects(HttpStatus.BAD_REQUEST, batch(event("feature_open", "").replace("\"web\"", "\"other\"")));
        rejects(HttpStatus.BAD_REQUEST, batch(event("feature_open", "").replace("replay_parse", "unknown")));
        rejects(HttpStatus.BAD_REQUEST, batch(event("feature_open", "").replaceFirst("\"occurred_at\":\"[^\"]+\"", "\"occurred_at\":\"2000-01-01T00:00:00Z\"")));
        rejects(HttpStatus.BAD_REQUEST, batch(event("feature_open", "").replaceFirst("\"occurred_at\":\"[^\"]+\"", "\"occurred_at\":\"2999-01-01T00:00:00Z\"")));
        rejects(HttpStatus.BAD_REQUEST, "{\"events\":[]}".getBytes(StandardCharsets.UTF_8));
        rejects(HttpStatus.BAD_REQUEST, "not json".getBytes(StandardCharsets.UTF_8));
        rejects(HttpStatus.BAD_REQUEST, (new String(batch(event("feature_open", "")), StandardCharsets.UTF_8)
                + " {}").getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void boundsBytesAndBatchSize() {
        rejects(HttpStatus.PAYLOAD_TOO_LARGE, new byte[16_385]);
        rejects(HttpStatus.BAD_REQUEST, repeatedBatch(21));
    }

    @Test
    void twentyEventBatchesCostTwentyForBothPools() {
        for (final Jwt jwt : new Jwt[]{null, user("weighted")}) {
            consume(jwt, "192.0.2.1", 120);
            limited(single(), jwt, "192.0.2.1");
        }
    }

    @Test
    void authenticatedSubjectsAreIsolated() {
        consume(user("a"), "192.0.2.1", 120);
        limited(single(), user("a"), "192.0.2.2");
        consume(user("b"), "192.0.2.1", 120);
    }

    @Test
    void anonymousSourcesAreIsolated() {
        consume(null, "192.0.2.1", 120);
        limited(single(), null, "192.0.2.1");
        consume(null, "192.0.2.2", 120);
    }

    @Test
    void anonymousGlobalCeilingCannotStarveAuthenticatedActivity() {
        for (int i = 0; i < 50; i++) {
            consume(null, "source-" + i, 120);
        }
        limited(single(), null, "new-source");
        service.accept(batch(event("active_user", "")), user("legitimate"), "source-0");
    }

    @Test
    void authenticatedGlobalCeilingCannotStarveAnonymousTraffic() {
        for (int i = 0; i < 50; i++) {
            consume(user("subject-" + i), "192.0.2.1", 120);
        }
        limited(single(), user("new-subject"), "192.0.2.1");
        service.accept(single(), null, "192.0.2.1");
    }

    @Test
    void globalRejectionDoesNotReserveUnusedCapacity() {
        for (int i = 0; i < 49; i++) {
            consume(null, "source-" + i, 120);
        }
        consume(null, "last-source", 119);
        limited(repeatedBatch(2), null, "new-source");
        service.accept(single(), null, "new-source");
        limited(single(), null, "new-source");
    }

    @Test
    void invalidBatchesAndRejectedRequestsConsumeNoQuotaOrPartialLogs() {
        consume(null, "192.0.2.1", 119);
        logger.setLevel(Level.INFO);
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            rejects(HttpStatus.BAD_REQUEST, "not json".getBytes(StandardCharsets.UTF_8));
            rejects(HttpStatus.BAD_REQUEST, batch(event("invalid", "")));
            rejects(HttpStatus.BAD_REQUEST, batch(""));
            rejects(HttpStatus.BAD_REQUEST, repeatedBatch(21));
            rejects(HttpStatus.PAYLOAD_TOO_LARGE, new byte[16_385]);
            rejects(HttpStatus.BAD_REQUEST, batch(event("feature_open", "") + "," + event("invalid", "")));
            limited(repeatedBatch(2), null, "192.0.2.1");
            assertTrue(appender.list.isEmpty());
            service.accept(single(), null, "192.0.2.1");
            assertEquals(1, appender.list.size());
            limited(single(), null, "192.0.2.1");
            assertEquals(1, appender.list.size());
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void bothMapsBoundNewKeysWithoutRejectingExistingKeys() {
        for (int i = 0; i < 4_096; i++) {
            service.accept(single(), null, "source-" + i);
            service.accept(single(), user("subject-" + i), "192.0.2.1");
        }
        limited(single(), null, "new-source");
        limited(single(), user("new-subject"), "192.0.2.1");
        service.accept(single(), null, "source-0");
        service.accept(single(), user("subject-0"), "192.0.2.1");
        when(clock.millis()).thenReturn(now.plusSeconds(60).toEpochMilli());
        service.accept(single(), null, "new-source");
        service.accept(single(), user("new-subject"), "192.0.2.1");
    }

    @Test
    void minuteRolloverResetsBothPoolsAndPerIdentityCounters() {
        consume(null, "192.0.2.1", 120);
        consume(user("subject"), "192.0.2.1", 120);
        when(clock.millis()).thenReturn(now.plusSeconds(60).toEpochMilli());
        consume(null, "192.0.2.1", 120);
        consume(user("subject"), "192.0.2.1", 120);
    }

    @Test
    void concurrentBatchesCannotOverdrawSourceCapacity() throws Exception {
        final AtomicInteger accepted = new AtomicInteger();
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var tasks = IntStream.range(0, 12).<Callable<Void>>mapToObj(index -> () -> {
                try {
                    service.accept(repeatedBatch(20), null, "192.0.2.1");
                    accepted.incrementAndGet();
                } catch (final ResponseStatusException exception) {
                    assertEquals(HttpStatus.TOO_MANY_REQUESTS, exception.getStatusCode());
                }
                return null;
            }).toList();
            for (final var result : executor.invokeAll(tasks)) {
                result.get();
            }
        }
        assertEquals(6, accepted.get());
    }

    private void consume(final Jwt jwt, final String source, final int cost) {
        for (int remaining = cost; remaining > 0; remaining -= Math.min(remaining, 20)) {
            service.accept(repeatedBatch(Math.min(remaining, 20)), jwt, source);
        }
    }

    private void limited(final byte[] body, final Jwt jwt, final String source) {
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, assertThrows(ResponseStatusException.class,
                () -> service.accept(body, jwt, source)).getStatusCode());
    }

    private static Jwt user(final String subject) {
        return Jwt.withTokenValue("private-token").header("alg", "none").subject(subject).build();
    }

    private static byte[] single() {
        return repeatedBatch(1);
    }

    private static byte[] repeatedBatch(final int count) {
        return batch(String.join(",", Collections.nCopies(count, event("feature_open", ""))));
    }

    private void rejects(final HttpStatus status, final byte[] body) {
        assertEquals(status, assertThrows(ResponseStatusException.class,
                () -> service.accept(body, null, "192.0.2.1")).getStatusCode());
    }

    private static byte[] batch(final String events) {
        return ("{\"events\":[" + events + "]}").getBytes(StandardCharsets.UTF_8);
    }

    private static String downloadClick() {
        final String id = UUID.randomUUID().toString();
        return "{\"event_id\":\"" + id + "\",\"event\":\"feature_open\",\"platform\":\"web\","
                + "\"feature\":\"android_download\",\"occurred_at\":\"" + Instant.now()
                + "\",\"operation_id\":\"" + id + "\"}";
    }

    private static String event(final String type, final String extra) {
        return "{\"event_id\":\"" + UUID.randomUUID() + "\",\"event\":\"" + type
                + "\",\"platform\":\"web\",\"feature\":\"replay_parse\",\"occurred_at\":\"" + Instant.now() + "\"" + extra + "}";
    }
}
