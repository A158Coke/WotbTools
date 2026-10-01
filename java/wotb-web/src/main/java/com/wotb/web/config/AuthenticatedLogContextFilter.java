package com.wotb.web.config;

import com.wotb.core.observability.LogContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** Security-chain only: runs after JWT validation, never trusts headers or client JSON. */
final class AuthenticatedLogContextFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(final HttpServletRequest request, final HttpServletResponse response,
                                  final FilterChain chain) throws ServletException, IOException {
        final Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        final String subject = authentication instanceof JwtAuthenticationToken jwt && jwt.isAuthenticated()
                ? jwt.getToken().getSubject() : null;
        try (final LogContext.Scope ignored = LogContext.with("userId", subject)) {
            chain.doFilter(request, response);
        }
    }
}
