package com.wotb.web.observability.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.observability.service.ObservabilityService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
public class ObservabilityController {
    private final ObservabilityService service;

    public ObservabilityController(final ObservabilityService service) {
        this.service = service;
    }

    @PostMapping(value = ApiPaths.OBSERVABILITY_EVENTS, consumes = "application/json")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void record(final HttpServletRequest request, @AuthenticationPrincipal final Jwt jwt) throws IOException {
        // Read at most the limit plus one byte, including chunked bodies, before parsing JSON.
        // No backend trusted-proxy resolver is configured. Ignore forwarded headers;
        // this transport peer is an ephemeral rate-limit source, not analytics identity.
        service.accept(request.getInputStream().readNBytes(16_385), jwt, request.getRemoteAddr());
    }
}
