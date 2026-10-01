package com.wotb.ai;

import com.wotb.core.observability.LogContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** Servlet tracing runs before Security so rejected requests also receive a request id. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AiRequestIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(final HttpServletRequest request, final HttpServletResponse response,
                                  final FilterChain chain) throws ServletException, IOException {
        final String requestId = LogContext.requestId(request.getHeader("X-Request-ID"));
        response.setHeader("X-Request-ID", requestId);
        try (final LogContext.Scope trace = LogContext.with("requestId", requestId);
             final LogContext.Scope identity = LogContext.with("userId", null)) {
            chain.doFilter(request, response);
        }
    }
}
