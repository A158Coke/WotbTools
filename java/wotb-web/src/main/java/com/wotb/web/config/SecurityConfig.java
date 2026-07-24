package com.wotb.web.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;

import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 安全配置: Keycloak JWT 认证 + 角色授权。
 * 权限层级:
 *   wotbtools-admin → 全部管理员接口（super admin）
 *   boost-manager    → 仅 /api/admin/boost/** 放行
 *   已登录用户        → 玩家接口 + boost 页面
 *   匿名用户          → 公开接口
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(final HttpSecurity http) {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .oauth2ResourceServer(rs -> rs.jwt(jwt -> jwt
                .jwtAuthenticationConverter(jwtAuthenticationConverter())
            ))
            .authorizeHttpRequests(auth -> auth
                // --- 公开接口 ---
                .requestMatchers("/api/boost/options").permitAll()
                .requestMatchers("/api/health", "/api/columns", "/api/rating",
                        "/api/preview", "/api/export").permitAll()
                .requestMatchers("/api/leaderboard/**").permitAll()

                // --- 管理员用户管理 (仅 wotbtools-admin) ---
                .requestMatchers("/api/admin/users/**",
                        "/api/replay/reconstruct",
                        "/api/replay/reconstruct-batch",
                        "/api/replay/state-at",
                        "/api/replay/process",
                        "/api/replay/analyze")
                    .hasRole("wotbtools-admin")

                // --- 打手管理（boost-manager 仅可访问该域） ---
                .requestMatchers("/api/admin/boost/**")
                    .hasAnyRole("wotbtools-admin", "boost-manager")

                // --- 其他管理员接口仅超级管理员 ---
                .requestMatchers("/api/admin/**")
                    .hasRole("wotbtools-admin")

                // --- 需登录接口 (wotbtools-admin 也是已登录用户，自动通过) ---
                .requestMatchers("/api/users/**",
                        "/api/boost/requests/**",
                        "/api/boost/boosters/**",
                        "/api/boost/booster-applications/**",
                        "/api/booster/**",
                        "/boost", "/boost/**")
                    .authenticated()

                // --- 未显式声明的 API 默认拒绝；静态资源放行 ---
                .requestMatchers("/api/**").denyAll()
                .anyRequest().permitAll()
            );
        return http.build();
    }

    /**
     * 自定义 JWT 角色提取：正确处理 Keycloak 嵌套 claim。
     * JWT 结构: { "realm_access": { "roles": ["boost-manager"] } }
     * Spring 默认 getClaim("realm_access.roles") 不做嵌套遍历，必须手动解。
     */
    private static Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter() {
        final JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            final Object rawRealmAccess = jwt.getClaim("realm_access");
            if (!(rawRealmAccess instanceof Map<?, ?> realmAccess)) {
                return List.of();
            }
            final Object rawRoles = realmAccess.get("roles");
            if (!(rawRoles instanceof Collection<?> roles)) {
                return List.of();
            }
            return roles.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .map(role -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + role))
                    .toList();
        });
        return converter;
    }
}