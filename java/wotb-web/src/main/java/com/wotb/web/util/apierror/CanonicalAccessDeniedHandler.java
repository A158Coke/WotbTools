package com.wotb.web.util.apierror;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.server.resource.web.access.BearerTokenAccessDeniedHandler;
import org.springframework.security.web.access.AccessDeniedHandler;

import java.io.IOException;

/** Preserves Bearer insufficient-scope headers while adding the canonical 403 response body. */
public class CanonicalAccessDeniedHandler implements AccessDeniedHandler {

    private final BearerTokenAccessDeniedHandler delegate = new BearerTokenAccessDeniedHandler();
    private final ApiErrorFactory factory;
    private final ApiErrorWriter writer;

    public CanonicalAccessDeniedHandler(final ApiErrorFactory factory, final ApiErrorWriter writer) {
        this.factory = factory;
        this.writer = writer;
    }

    @Override
    public void handle(final HttpServletRequest request, final HttpServletResponse response,
                       final AccessDeniedException accessDeniedException) throws IOException, ServletException {
        delegate.handle(request, response, accessDeniedException);
        writer.write(response, factory.create(ApiErrorCode.AUTH_FORBIDDEN, request));
    }
}
