package com.wotb.web.boost.util;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

/** JWT 工具：从当前 SecurityContext 提取 Keycloak 用户信息。 */
public final class JwtUtil {

    private JwtUtil() {
        // 工具类
    }

    /** 从当前 JWT 提取用户 Keycloak ID（sub claim，完整 UUID 字符串）。 */
    public static String currentUserId() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        final String sub = jwt.getSubject();
        if (sub == null || sub.isBlank()) {
            return null;
        }
        return sub;
    }

    /** 从当前 JWT 提取用户名（preferred_username）。 */
    public static String currentUsername() {
        final var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof final Jwt jwt)) {
            return null;
        }
        return jwt.getClaimAsString("preferred_username");
    }
}
