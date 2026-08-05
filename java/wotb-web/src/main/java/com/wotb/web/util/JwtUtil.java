package com.wotb.web.util;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

/**
 * JWT 工具：从当前 SecurityContext 提取 Keycloak 用户信息。
 */
public final class JwtUtil {

    private JwtUtil() {}

    /**
     * 从当前 JWT 提取用户 Keycloak ID（sub claim）。
     */
    public static String currentUserId() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        final String sub = jwt.getSubject();
        return StringUtils.hasText(sub) ? sub : null;
    }

    /**
     * 从当前 JWT 提取 username（preferred_claim，唯一带 hash 后缀）。
     */
    public static String currentUsername() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        return jwt.getClaimAsString("preferred_username");
    }

    /**
     * 从当前 JWT 提取 displayName（由 Keycloak protocol mapper 映射的 user attribute）。
     * QQ 昵称等用户可读展示名，不含唯一性 hash 后缀。
     */
    public static String currentDisplayName() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        return jwt.getClaimAsString("displayName");
    }

    /**
     * 从当前 JWT 提取 region claim（Keycloak 用户属性 {@code region} 映射为 {@code wotb_region}）。
     * 缺失返回 null；后端一律按 CN 兜底。
     */
    public static String currentWotbRegion() {
        final Jwt jwt = currentJwt();
        return jwt == null ? null : jwt.getClaimAsString("wotb_region");
    }

    /**
     * 从当前 JWT 提取 verified claim（Keycloak 映射为真布尔 {@code wotb_verified}）。
     * 缺失或非 true 一律视为 false。
     */
    public static boolean currentWotbVerified() {
        final Jwt jwt = currentJwt();
        if (jwt == null) {
            return false;
        }
        final Object raw = jwt.getClaim("wotb_verified");
        return raw instanceof final Boolean verified && verified;
    }

    /**
     * 从当前 JWT 提取 WoTB account id（claim 为纯数字字符串）。缺失/非法返回 null。
     */
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

    /**
     * 从当前 JWT 提取官方昵称 claim。缺失返回 null。
     */
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

    /**
     * 提取当前用户 ID，未登录时抛 401。
     */
    public static String requireUserId() {
        final String uid = currentUserId();
        if (uid == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED");
        }
        return uid;
    }
}
