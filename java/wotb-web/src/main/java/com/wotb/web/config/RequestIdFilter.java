package com.wotb.web.config;

import com.wotb.web.util.apierror.RequestTrace;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = RequestTrace.HEADER;
    public static final String MDC_KEY = RequestTrace.REQUEST_ID_MDC_KEY;
    public static final String TRACE_MDC_KEY = RequestTrace.TRACE_ID_MDC_KEY;
    public static final String REQUEST_ATTRIBUTE = RequestTrace.REQUEST_ATTRIBUTE;

    @Override
    protected void doFilterInternal(
            final HttpServletRequest request,
            final HttpServletResponse response,
            final FilterChain filterChain) throws ServletException, IOException {

        final String header = request.getHeader(HEADER);
        final String requestId = header == null || header.isBlank()
                ? UUID.randomUUID().toString()
                : RequestTrace.sanitize(header);

        MDC.put(MDC_KEY, requestId);
        MDC.put(TRACE_MDC_KEY, requestId);
        request.setAttribute(REQUEST_ATTRIBUTE, requestId);
        response.setHeader(HEADER, requestId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
            MDC.remove(TRACE_MDC_KEY);
        }
    }

}
