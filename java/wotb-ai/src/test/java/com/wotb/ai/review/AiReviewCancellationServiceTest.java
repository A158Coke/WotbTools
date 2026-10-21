package com.wotb.ai.review;

import com.wotb.ai.review.service.AiReviewCancellationService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiReviewCancellationServiceTest {
    @Test void activeAndUnknownRequestsKeepBestEffortSemantics() {
        final AiCancellationRegistry registry = new AiCancellationRegistry();
        final String correlationId = UUID.randomUUID().toString();
        final var token = registry.register(correlationId);
        assertNotNull(token);
        final var service = new AiReviewCancellationService(registry);
        service.cancel(correlationId);
        assertTrue(token.isCancelled());
        service.cancel(UUID.randomUUID().toString());
    }

    @Test void invalidCorrelationIdIsBadRequest() {
        final var service = new AiReviewCancellationService(new AiCancellationRegistry());
        final var error = assertThrows(ResponseStatusException.class, () -> service.cancel("bad-id"));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        assertEquals("INVALID_CORRELATION_ID", error.getReason());
    }
}
