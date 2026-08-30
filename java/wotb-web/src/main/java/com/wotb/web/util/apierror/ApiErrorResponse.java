package com.wotb.web.util.apierror;

import java.time.Instant;
import java.util.Map;

/** Stable error envelope returned by every Spring MVC and Security error path. */
public record ApiErrorResponse(
        String code,
        int status,
        String messageKey,
        String traceId,
        boolean retryable,
        Map<String, Object> details,
        Instant timestamp) {
}
