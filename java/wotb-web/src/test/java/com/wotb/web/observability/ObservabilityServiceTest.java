package com.wotb.web.observability;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wotb.web.observability.service.ObservabilityService;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ObservabilityServiceTest {
    private final ObservabilityService service = new ObservabilityService(JsonMapper.builder().build(), "test-only-key-with-at-least-32-bytes");

    @Test
    void acceptsAnonymousFeatureAndAllParseOutcomes() {
        service.accept(batch(event("feature_open", "")), null);
        for (final String outcome : new String[]{"start", "success", "failure", "cancelled"}) {
            service.accept(batch(event("replay_parse", ",\"operation_id\":\"" + UUID.randomUUID()
                    + "\",\"outcome\":\"" + outcome + "\"")), null);
        }
    }

    @Test
    void activeUserRequiresVerifiedSubjectAndConfiguredKey() {
        rejects(HttpStatus.UNAUTHORIZED, batch(event("active_user", "")));
        final Jwt jwt = Jwt.withTokenValue("secret-token").header("alg", "none").subject("private-user").build();
        final ObservabilityService disabled = new ObservabilityService(JsonMapper.builder().build(), "");
        disabled.accept(batch(event("feature_open", "")), jwt);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows(ResponseStatusException.class,
                () -> disabled.accept(batch(event("active_user", "")), jwt)).getStatusCode());
    }

    @Test
    void hashesAuthenticatedSubjectWithoutLeakingIdentityOrCredential() {
        final Logger logger = (Logger) LoggerFactory.getLogger(ObservabilityService.class);
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            final Jwt jwt = Jwt.withTokenValue("secret-token").header("alg", "none").subject("private-user").build();
            service.accept(batch(event("active_user", "")), jwt);
            final String line = appender.list.getFirst().getFormattedMessage();
            assertTrue(line.matches(".*account_hash=[a-f0-9]{64}$"));
            assertFalse(line.contains("private-user"));
            assertFalse(line.contains("secret-token"));
            assertFalse(line.contains("private-ip"));
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
    void boundsBytesBatchesAndRequestFrequency() {
        rejects(HttpStatus.PAYLOAD_TOO_LARGE, new byte[16_385]);
        final String many = String.join(",", java.util.Collections.nCopies(21, event("feature_open", "")));
        rejects(HttpStatus.BAD_REQUEST, batch(many));
        final Jwt jwt = Jwt.withTokenValue("token").header("alg", "none").subject("limited").build();
        for (int i = 0; i < 120; i++) {
            service.accept(batch(event("feature_open", "")), jwt);
        }
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, assertThrows(ResponseStatusException.class,
                () -> service.accept(batch(event("feature_open", "")), jwt)).getStatusCode());
    }

    private void rejects(final HttpStatus status, final byte[] body) {
        assertEquals(status, assertThrows(ResponseStatusException.class,
                () -> service.accept(body, null)).getStatusCode());
    }

    private static byte[] batch(final String events) {
        return ("{\"events\":[" + events + "]}").getBytes(StandardCharsets.UTF_8);
    }

    private static String event(final String type, final String extra) {
        return "{\"event_id\":\"" + UUID.randomUUID() + "\",\"event\":\"" + type
                + "\",\"platform\":\"web\",\"feature\":\"replay_parse\",\"occurred_at\":\"" + Instant.now() + "\"" + extra + "}";
    }
}
