package com.wotb.ai.http;

import java.time.Instant;
import java.util.Map;

/** AI-service-owned runtime representation of the OpenAPI {@code ApiError} wire schema. */
public record ApiErrorResponse(
        String id,
        String errorCode,
        String errorMsg,
        int status,
        boolean retryable,
        Map<String, Object> details,
        Instant timestamp) {
}
