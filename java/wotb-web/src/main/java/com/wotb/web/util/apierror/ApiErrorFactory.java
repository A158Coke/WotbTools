package com.wotb.web.util.apierror;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.Map;

/** Single source for canonical error metadata and safe response construction. */
@Component
public class ApiErrorFactory {

    public ApiErrorResponse create(final ApiErrorCode code, final HttpServletRequest request) {
        return new ApiErrorResponse(
                RequestTrace.resolve(request),
                code.name(),
                null,
                code.status().value(),
                code.retryable(),
                Map.of(),
                Instant.now());
    }

    public ApiErrorResponse create(final String code, final HttpStatus status,
                                   final HttpServletRequest request) {
        return create(code, status, retryable(code, status), Map.of(), request);
    }

    public ApiErrorResponse create(final String code, final HttpStatus status,
                                   final Map<String, Object> details,
                                   final HttpServletRequest request) {
        return create(code, status, retryable(code, status), details, request);
    }

    public ApiErrorResponse create(final String code, final HttpStatus status,
                                   final boolean retryable, final Map<String, Object> details,
                                   final HttpServletRequest request) {
        final String safeCode = StringUtils.hasText(code) ? code : ApiErrorCode.INTERNAL_ERROR.name();
        return new ApiErrorResponse(
                RequestTrace.resolve(request),
                safeCode,
                null,
                status.value(),
                retryable,
                details == null ? Map.of() : Map.copyOf(details),
                Instant.now());
    }

    public ApiErrorResponse create(final ApiException exception, final HttpServletRequest request) {
        final ApiErrorCode code = exception.errorCode();
        return new ApiErrorResponse(
                exception.id(),
                code.name(),
                exception.errorMsg(),
                code.status().value(),
                code.retryable(),
                exception.details(),
                Instant.now());
    }

    private static boolean retryable(final String code, final HttpStatus status) {
        return switch (code) {
            case "REPLAY_BUSY", "PROCESSING_QUEUE_FULL", "EXPORT_QUEUE_FULL", "AI_REVIEW_BUSY",
                 "AI_QUEUE_FULL", "AI_RATE_LIMITED", "AI_UPSTREAM_TIMEOUT", "AI_UPSTREAM_UNAVAILABLE",
                 "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE",
                 "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "ADMIN_INTERNAL_ERROR", "STORAGE_ERROR" -> true;
            case "AI_TIMEOUT", "AI_CANCELLED", "AI_NOT_CONFIGURED" -> false;
            default -> status.is5xxServerError()
                    && !code.endsWith("_UNAVAILABLE")
                    && !code.endsWith("_CANCELLED");
        };
    }
}
