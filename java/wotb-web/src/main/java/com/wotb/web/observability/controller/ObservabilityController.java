package com.wotb.web.observability.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.util.admission.TrustedClientSource;
import com.wotb.web.observability.service.ObservabilityService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
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
    private final TrustedClientSource clientSource;

    public ObservabilityController(final ObservabilityService service,
            @Value("${WOTB_OBSERVABILITY_TRUSTED_PROXIES:}") final String trustedProxies) {
        this.service = service;
        this.clientSource = new TrustedClientSource(trustedProxies);
    }

    @PostMapping(value = ApiPaths.OBSERVABILITY_EVENTS, consumes = "application/json")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void record(final HttpServletRequest request, @AuthenticationPrincipal final Jwt jwt) throws IOException {
        // Read at most the limit plus one byte, including chunked bodies, before parsing JSON.
        service.accept(request.getInputStream().readNBytes(16_385), jwt, clientSource.resolve(request));
    }

}
