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
     * 提取当前用户 ID，未登录时抛 401。
     */
    public static String requireUserId() {
        final String uid = currentUserId();
        if (uid == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "请先登录");
        }
        return uid;
    }
}
