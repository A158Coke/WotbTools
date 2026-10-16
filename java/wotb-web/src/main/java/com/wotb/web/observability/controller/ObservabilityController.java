package com.wotb.web.observability.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.observability.service.ObservabilityService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.web.util.matcher.IpAddressMatcher;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.net.InetAddress;
import java.util.Arrays;
import java.util.List;

@RestController
public class ObservabilityController {
    private final ObservabilityService service;
    private final List<IpAddressMatcher> trustedProxies;

    public ObservabilityController(final ObservabilityService service,
            @Value("${WOTB_OBSERVABILITY_TRUSTED_PROXIES:}") final String trustedProxies) {
        this.service = service;
        this.trustedProxies = Arrays.stream(trustedProxies.split(","))
                .map(String::trim).filter(value -> !value.isEmpty()).map(IpAddressMatcher::new).toList();
    }

    @PostMapping(value = ApiPaths.OBSERVABILITY_EVENTS, consumes = "application/json")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void record(final HttpServletRequest request, @AuthenticationPrincipal final Jwt jwt) throws IOException {
        // Read at most the limit plus one byte, including chunked bodies, before parsing JSON.
        service.accept(request.getInputStream().readNBytes(16_385), jwt, clientSource(request));
    }

    private String clientSource(final HttpServletRequest request) {
        final String peer = request.getRemoteAddr();
        if (trustedProxies.stream().noneMatch(proxy -> proxy.matches(peer))) {
            return peer;
        }
        // Trusted nginx overwrites this single-address header after Caddy real-IP processing.
        // Never select an address from client-controlled XFF / Forwarded chains.
        final var headers = request.getHeaders("X-Real-IP");
        if (headers == null || !headers.hasMoreElements()) {
            return peer;
        }
        final String address = headers.nextElement();
        if (headers.hasMoreElements() || address.contains("%")) {
            return peer;
        }
        try {
            // Literal-only parsing: no DNS lookup; canonicalize IPv6 spellings to one bucket.
            return InetAddress.ofLiteral(address).getHostAddress();
        } catch (final IllegalArgumentException exception) {
            return peer;
        }
    }
}
