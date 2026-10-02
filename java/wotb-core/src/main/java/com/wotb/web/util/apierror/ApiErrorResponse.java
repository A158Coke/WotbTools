package com.wotb.web.util.apierror;

import java.time.Instant;
import java.util.Map;

/**
 * Stable error envelope returned by every Spring MVC and Security error path.
 *
 * <p>Converged to a single error ID contract: {@code id} is the per-error identifier (the
 * {@code ApiException} instance id for typed errors, or the request correlation id for
 * non-typed/security/legacy errors), {@code errorCode} is the stable machine-readable code
 * (enum name for {@code ApiErrorCode} paths), and {@code errorMsg} is the optional safe
 * diagnostic text. No competing {@code code}/{@code messageKey}/{@code traceId} fields.</p>
 *
 * <p>Lives in {@code wotb-core} (package {@code com.wotb.web.util.apierror}) so both the Business
 * Backend ({@code wotb-web}) and the standalone {@code ai-service} ({@code wotb-ai}) can share one
 * envelope instead of each declaring its own copy; the shape itself is owned by
 * {@code contracts/http/openapi.yaml} ({@code ApiError}).</p>
 */
public record ApiErrorResponse(
        String id,
        String errorCode,
        String errorMsg,
        int status,
        boolean retryable,
        Map<String, Object> details,
        Instant timestamp) {
}
