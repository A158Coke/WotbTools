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

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

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
                .requestMatchers("/api/users/**",
                        "/api/boost/requests/**", "/boost", "/boost/**")
                    .authenticated()

                // --- 其他放行 ---
                .anyRequest().permitAll()
            );
        return http.build();
    }

    /**
     * 自定义 JWT 角色提取：正确处理 Keycloak 嵌套 claim。
     * JWT 结构: { "realm_access": { "roles": ["boost-manager"] } }
     * Spring 默认 getClaim("realm_access.roles") 不做嵌套遍历，必须手动解。
     */
    private Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter() {
        final JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            final Collection<GrantedAuthority> authorities = new ArrayList<>();
            final Map<String, Object> realmAccess = jwt.getClaim("realm_access");
            if (realmAccess != null) {
                @SuppressWarnings("unchecked")
                final List<String> roles = (List<String>) realmAccess.get("roles");
                if (roles != null) {
                    for (final String role : roles) {
                        authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
                    }
                }
            }
            return authorities;
        });
        return converter;
    }
}
