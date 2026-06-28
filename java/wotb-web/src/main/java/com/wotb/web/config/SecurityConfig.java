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

/** 安全配置: Keycloak JWT + admin 角色。测试阶段仍放行大部分请求。 */
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
                // 公开接口
                .requestMatchers("/api/boost/options").permitAll()
                .requestMatchers("/api/health", "/api/columns", "/api/rating",
                        "/api/preview", "/api/export").permitAll()
                .requestMatchers("/api/leaderboard/**").permitAll()
                // 玩家接口: 需登录
                .requestMatchers("/api/boost/requests/**").authenticated()
                // boost 页面: 需登录
                .requestMatchers("/boost", "/boost/**").authenticated()
                // 管理员接口: 需 wotbtools-admin 角色
                .requestMatchers("/api/admin/**").hasAnyRole("wotbtools-admin", "boost-manager")
                // 其他放行 (测试阶段)
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
