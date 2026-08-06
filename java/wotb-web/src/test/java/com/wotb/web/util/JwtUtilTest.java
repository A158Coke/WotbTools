package com.wotb.web.util;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JwtUtilTest {

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private static void login(final Jwt jwt) {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(jwt, null));
    }

    private static Jwt jwtWith(final Map<String, Object> claims) {
        final Jwt.Builder builder = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("kc-user")
                .claim("preferred_username", "512345678")
                .claim("displayName", "PlayerOne");
        claims.forEach(builder::claim);
        return builder.build();
    }

    @Test
    void wgClaimsParsedWhenPresent() {
        login(jwtWith(Map.of(
                "wotb_region", "ASIA",
                "wotb_account_id", "512345678",
                "wotb_nickname", "PlayerOne",
                "wotb_verified", true)));

        assertEquals("ASIA", JwtUtil.currentWotbRegion());
        assertEquals(512345678L, JwtUtil.currentWotbAccountId());
        assertEquals("PlayerOne", JwtUtil.currentWotbNickname());
        assertTrue(JwtUtil.currentWotbVerified());
    }

    @Test
    void wgClaimsMissingFallBackToCnDefaults() {
        login(jwtWith(Map.of()));

        assertNull(JwtUtil.currentWotbRegion());
        assertNull(JwtUtil.currentWotbAccountId());
        assertNull(JwtUtil.currentWotbNickname());
        assertFalse(JwtUtil.currentWotbVerified());
    }

    @Test
    void invalidAccountIdReturnsNull() {
        login(jwtWith(Map.of("wotb_account_id", "abc")));
        assertNull(JwtUtil.currentWotbAccountId());
    }

    @Test
    void stringVerifiedClaimIsTrusted() {
        login(jwtWith(Map.of("wotb_verified", "true")));
        assertTrue(JwtUtil.currentWotbVerified());
    }

    @Test
    void noAuthenticationReturnsNulls() {
        assertNull(JwtUtil.currentWotbRegion());
        assertNull(JwtUtil.currentWotbAccountId());
        assertNull(JwtUtil.currentWotbNickname());
        assertFalse(JwtUtil.currentWotbVerified());
    }
}
