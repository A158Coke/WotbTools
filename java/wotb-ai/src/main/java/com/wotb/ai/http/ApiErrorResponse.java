package com.wotb.ai.http;

import java.time.Instant;
import java.util.Map;

public record ApiErrorResponse(
        String id,
        String errorCode,
        String errorMsg,
        int status,
        boolean retryable,
        Map<String, Object> details,
        Instant timestamp) {
}
