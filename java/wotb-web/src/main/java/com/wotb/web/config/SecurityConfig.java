package com.wotb.web.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

/**
 * 安全配置: Keycloak JWT 认证 + 角色授权。
 *
 * 权限层级:
 *   wotbtools-admin → 全部放行（super admin）
 *   boost-manager    → /api/admin/** 放行
 *   已登录用户        → 玩家接口 + boost 页面
 *   匿名用户          → 公开接口
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(final HttpSecurity http) throws Exception {
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

                // --- 管理员接口 (wotbtools-admin 放行全部，boost-manager 放行管理) ---
                .requestMatchers("/api/admin/**")
                    .hasAnyRole("wotbtools-admin", "boost-manager")

                // --- 需登录接口 (wotbtools-admin 也是已登录用户，自动通过) ---
                .requestMatchers("/api/boost/requests/**", "/boost", "/boost/**")
                    .authenticated()

                // --- 其他放行 ---
                .anyRequest().permitAll()
            );
        return http.build();
    }

    /** 从 Keycloak JWT 的 realm_access.roles 提取角色，prefix "ROLE_"。 */
    private JwtAuthenticationConverter jwtAuthenticationConverter() {
        final JwtGrantedAuthoritiesConverter grantedAuthorities = new JwtGrantedAuthoritiesConverter();
        grantedAuthorities.setAuthoritiesClaimName("realm_access.roles");
        grantedAuthorities.setAuthorityPrefix("ROLE_");
        final JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(grantedAuthorities);
        return converter;
    }
}
