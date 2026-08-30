package com.wotb.web.util.apierror;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.server.resource.web.BearerTokenAuthenticationEntryPoint;
import org.springframework.security.web.AuthenticationEntryPoint;

import java.io.IOException;

/** Preserves Bearer challenge headers while adding the canonical 401 response body. */
public class CanonicalAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final BearerTokenAuthenticationEntryPoint delegate = new BearerTokenAuthenticationEntryPoint();
    private final ApiErrorFactory factory;
    private final ApiErrorWriter writer;

    public CanonicalAuthenticationEntryPoint(final ApiErrorFactory factory, final ApiErrorWriter writer) {
        this.factory = factory;
        this.writer = writer;
    }

    @Override
    public void commence(final HttpServletRequest request, final HttpServletResponse response,
                         final AuthenticationException authException) throws IOException, ServletException {
        delegate.commence(request, response, authException);
        writer.write(response, factory.create(ApiErrorCode.AUTH_UNAUTHENTICATED, request));
    }
}
