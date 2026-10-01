package com.wotb.web.util.observability;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ClientEventServiceTest {
    private static final String VALID = "{\"event\":\"client.wasm_load_failed\",\"platform\":\"web\",\"errorCode\":\"CLIENT_WASM_LOAD_FAILED\"}";

    @Test
    void acceptsOnlyClosedSafeShape() throws IOException {
        assertEquals(HttpStatus.NO_CONTENT, accept(VALID));
        assertEquals(HttpStatus.BAD_REQUEST, accept(VALID.replace("}", ",\"userId\":\"spoofed\"}")));
        assertEquals(HttpStatus.BAD_REQUEST, accept(VALID.replace("}", ",\"message\":\"secret\"}")));
        assertEquals(HttpStatus.BAD_REQUEST, accept(VALID.replace("}", ",\"correlationId\":\"token-secret\"}")));
        assertEquals(HttpStatus.BAD_REQUEST, accept(VALID.replace("}", ",\"platform\":\"android\"}")));
        assertEquals(HttpStatus.BAD_REQUEST, accept(VALID + " {}"));
        assertEquals(HttpStatus.BAD_REQUEST, accept(VALID.replace("CLIENT_WASM_LOAD_FAILED", "TOKEN_SECRET")));
        assertEquals(HttpStatus.BAD_REQUEST, accept("[]"));
        assertEquals(HttpStatus.BAD_REQUEST, accept("null"));
        assertEquals(HttpStatus.CONTENT_TOO_LARGE, accept(" ".repeat(4097)));
    }

    @Test
    void throttlesPeerAndBoundsGlobalReports() throws IOException {
        final ClientEventService service = new ClientEventService();
        final Jwt jwt = Jwt.withTokenValue("test").header("alg", "RS256").subject("verified-sub").build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, java.util.List.of()));
        try {
            for (int i = 0; i < 10; i++) assertEquals(HttpStatus.NO_CONTENT, service.accept(request(VALID, "peer")));
            assertEquals(HttpStatus.TOO_MANY_REQUESTS, service.accept(request(VALID, "peer")));
        } finally {
            SecurityContextHolder.clearContext();
        }
        for (int i = 0; i < 290; i++) assertEquals(HttpStatus.NO_CONTENT, service.accept(request(VALID, "peer-" + i)));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, service.accept(request(VALID, "next")));
    }

    private static HttpStatus accept(final String body) throws IOException {
        return new ClientEventService().accept(request(body, "peer"));
    }

    private static MockHttpServletRequest request(final String body, final String peer) {
        final MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContent(body.getBytes(StandardCharsets.UTF_8));
        request.setRemoteAddr(peer);
        return request;
    }
}
