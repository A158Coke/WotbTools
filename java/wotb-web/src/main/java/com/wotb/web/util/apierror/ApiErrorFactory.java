package com.wotb.web.util.apierror;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** Single source for canonical error metadata and safe response construction. */
@Component
public class ApiErrorFactory {

    public ApiErrorResponse create(final ApiErrorCode code, final HttpServletRequest request) {
        return create(code.name(), code.status(), code.retryable(), Map.of(), request);
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
                safeCode,
                status.value(),
                "errors." + safeCode.toLowerCase(Locale.ROOT),
                traceId(request),
                retryable,
                details == null ? Map.of() : Map.copyOf(details),
                Instant.now());
    }

    public ApiErrorResponse create(final ApiException exception, final HttpServletRequest request) {
        final ApiErrorCode code = exception.errorCode();
        return create(code.name(), code.status(), code.retryable(), exception.details(), request);
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

    private static String traceId(final HttpServletRequest request) {
        if (request != null) {
            final Object attribute = request.getAttribute(RequestTrace.REQUEST_ATTRIBUTE);
            if (attribute instanceof String value && StringUtils.hasText(value)) {
                return value;
            }
            final String header = request.getHeader(RequestTrace.HEADER);
            if (StringUtils.hasText(header)) {
                return RequestTrace.sanitize(header);
            }
        }
        final String mdc = MDC.get(RequestTrace.REQUEST_ID_MDC_KEY);
        return StringUtils.hasText(mdc) ? mdc : UUID.randomUUID().toString();
    }
}
