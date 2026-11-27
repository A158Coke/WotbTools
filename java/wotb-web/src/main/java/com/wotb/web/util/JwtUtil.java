package com.wotb.web.util;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

public final class JwtUtil {

    private JwtUtil() {}

    public static String currentUserId() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        final String sub = jwt.getSubject();
        return StringUtils.hasText(sub) ? sub : null;
    }

    public static String currentUsername() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        return jwt.getClaimAsString("preferred_username");
    }

    public static String currentDisplayName() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        return jwt.getClaimAsString("displayName");
    }

    public static String currentWotbRegion() {
        final Jwt jwt = currentJwt();
        return jwt == null ? null : jwt.getClaimAsString("wotb_region");
    }

    public static boolean currentWotbVerified() {
        final Jwt jwt = currentJwt();
        if (jwt == null) {
            return false;
        }
        final Object raw = jwt.getClaim("wotb_verified");
        if (raw instanceof final Boolean verified) {
            return verified;
        }
        return "true".equals(raw);
    }

    public static Long currentWotbAccountId() {
        final Jwt jwt = currentJwt();
        if (jwt == null) {
            return null;
        }
        final String raw = jwt.getClaimAsString("wotb_account_id");
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        try {
            final long value = Long.parseLong(raw.trim());
            return value > 0 ? value : null;
        } catch (final NumberFormatException e) {
            return null;
        }
    }

    public static String currentWotbNickname() {
        final Jwt jwt = currentJwt();
        return jwt == null ? null : jwt.getClaimAsString("wotb_nickname");
    }

    private static Jwt currentJwt() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        return jwt;
    }

    public static String requireUserId() {
        final String uid = currentUserId();
        if (uid == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED");
        }
        return uid;
    }
}
