package com.wotb.ai;

import com.wotb.web.util.apierror.ApiErrorResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 锁定「提交 worker 之前」的失败必须返回契约的 {@code ApiError} envelope 与稳定 {@code errorCode}，
 * 而不是 Spring 默认错误体；并锁定 503 准入饱和是唯一可重试类别。
 */
class AiReviewExceptionHandlerTest {

    private final AiReviewExceptionHandler handler = new AiReviewExceptionHandler();

    @Test
    void mapsPreStreamFailuresToContractEnvelope() {
        final ResponseEntity<ApiErrorResponse> response = handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "UNSUPPORTED_BATTLE_CATEGORY"));

        assertEquals(422, response.getStatusCode().value());
        final ApiErrorResponse body = response.getBody();
        assertNotNull(body);
        assertEquals("UNSUPPORTED_BATTLE_CATEGORY", body.errorCode());
        assertEquals(422, body.status());
        assertFalse(body.retryable());
        assertNull(body.errorMsg());
        assertNull(body.id());
        assertNotNull(body.details());
        assertNotNull(body.timestamp());
    }

    @Test
    void marksBoundedAdmissionSaturationRetryable() {
        final ApiErrorResponse body = handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI_REVIEW_BUSY")).getBody();

        assertNotNull(body);
        assertEquals("AI_REVIEW_BUSY", body.errorCode());
        assertEquals(503, body.status());
        assertTrue(body.retryable());
    }

    @Test
    void requestSizeAndDuplicateCorrelationStayNonRetryable() {
        assertEquals(413, body(handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "AI_REQUEST_TOO_LARGE"))).status());
        assertFalse(body(handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "AI_REQUEST_TOO_LARGE"))).retryable());

        final ApiErrorResponse conflict = body(handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.CONFLICT, "DUPLICATE_CORRELATION_ID")));
        assertEquals("DUPLICATE_CORRELATION_ID", conflict.errorCode());
        assertEquals(409, conflict.status());
        assertFalse(conflict.retryable());
    }

    @Test
    void fallsBackToInvalidRequestWhenReasonIsAbsent() {
        final ApiErrorResponse body = body(handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.BAD_REQUEST)));

        assertEquals("INVALID_REQUEST", body.errorCode());
        assertEquals(400, body.status());
        assertFalse(body.retryable());
    }

    private static ApiErrorResponse body(final ResponseEntity<ApiErrorResponse> response) {
        final ApiErrorResponse body = response.getBody();
        assertNotNull(body);
        return body;
    }
}
