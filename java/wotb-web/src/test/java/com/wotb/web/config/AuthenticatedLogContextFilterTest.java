package com.wotb.web.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class AuthenticatedLogContextFilterTest {
    @AfterEach
    void clear() { MDC.clear(); SecurityContextHolder.clearContext(); }

    @Test
    void onlyValidatedJwtSubjectBecomesIdentity() throws Exception {
        final Jwt token = Jwt.withTokenValue("unused-test-token").header("alg", "RS256")
                .subject("trusted-sub").claim("preferred_username", "untrusted-alias").build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(token, java.util.List.of()));
        final MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-User-ID", "forged-user");
        new AuthenticatedLogContextFilter().doFilter(request, new MockHttpServletResponse(), (req, res) ->
                assertEquals("trusted-sub", MDC.get("userId")));
        assertNull(MDC.get("userId"));
    }

    @Test
    void nonJwtPrincipalCannotSupplyUserIdentity() throws Exception {
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken("named-user", "", "ROLE_USER"));
        MDC.put("userId", "previous-context");
        new AuthenticatedLogContextFilter().doFilter(new MockHttpServletRequest(), new MockHttpServletResponse(), (req, res) ->
                assertNull(MDC.get("userId")));
        assertEquals("previous-context", MDC.get("userId"));
    }
}
