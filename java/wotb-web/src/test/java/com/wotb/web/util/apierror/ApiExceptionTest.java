package com.wotb.web.util.apierror;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiExceptionTest {

    @Test
    void internalExceptionUsesTypedCodeIdAndOptionalDiagnosticMessage() {
        final ApiException withMessage = new ApiException(
                ApiErrorCode.INVALID_ARGUMENT, "invalid dataset reference", Map.of("field", "sourceId"));
        final ApiException withoutMessage = new ApiException(ApiErrorCode.INTERNAL_ERROR);

        assertEquals(ApiErrorCode.INVALID_ARGUMENT, withMessage.errorCode());
        assertFalse(withMessage.id().isBlank());
        assertEquals("invalid dataset reference", withMessage.errorMsg());
        assertEquals("invalid dataset reference", withMessage.diagnosticMessage());
        assertEquals(withoutMessage.id(), withoutMessage.diagnosticMessage());
    }

    @Test
    void externalEnvelopeExposesSingleErrorIdAndSafeDiagnosticMessage() {
        final ApiException exception = new ApiException(
                ApiErrorCode.INTERNAL_ERROR, "database host is private", Map.of());
        final MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(RequestTrace.REQUEST_ATTRIBUTE, "trace-safe-500");

        final ApiErrorResponse response = new ApiErrorFactory().create(exception, request);

        assertEquals("INTERNAL_ERROR", response.errorCode());
        assertEquals(500, response.status());
        assertEquals(exception.id(), response.id());
        assertEquals("database host is private", response.errorMsg());
        assertFalse(response.toString().contains("trace-safe-500"));
    }

    @Test
    void legacyAiCodesKeepTheirEstablishedRetryPolicy() {
        final ApiErrorFactory factory = new ApiErrorFactory();

        assertFalse(factory.create("AI_TIMEOUT", HttpStatus.BAD_GATEWAY, null).retryable());
        assertTrue(factory.create(
                "AI_UPSTREAM_UNAVAILABLE", HttpStatus.BAD_GATEWAY, null).retryable());
    }
}
