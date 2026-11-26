package com.wotb.web.util.apierror;

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
