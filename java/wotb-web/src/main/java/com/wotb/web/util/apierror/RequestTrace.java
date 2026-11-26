package com.wotb.web.util.apierror;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.MDC;
import org.springframework.util.StringUtils;

import java.util.UUID;

public final class RequestTrace {

    public static final String HEADER = "X-Request-ID";
    public static final String REQUEST_ID_MDC_KEY = "requestId";
    public static final String TRACE_ID_MDC_KEY = "traceId";
    public static final String REQUEST_ATTRIBUTE = RequestTrace.class.getName() + ".requestId";

    private RequestTrace() {
    }

    public static String sanitize(final String value) {
        final StringBuilder safe = new StringBuilder(Math.min(value.length(), 128));
        for (int index = 0; index < value.length() && safe.length() < 128; index++) {
            final char current = value.charAt(index);
            if (Character.isLetterOrDigit(current) || current == '-' || current == '_' || current == '.') {
                safe.append(current);
            }
        }
        return safe.isEmpty() ? UUID.randomUUID().toString() : safe.toString();
    }

    public static String resolve(final HttpServletRequest request) {
        if (request != null) {
            final Object attribute = request.getAttribute(REQUEST_ATTRIBUTE);
            if (attribute instanceof String value && StringUtils.hasText(value)) {
                return value;
            }
            final String header = request.getHeader(HEADER);
            if (StringUtils.hasText(header)) {
                return sanitize(header);
            }
        }
        final String mdc = MDC.get(REQUEST_ID_MDC_KEY);
        return StringUtils.hasText(mdc) ? mdc : UUID.randomUUID().toString();
    }
}
