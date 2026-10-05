package com.wotb.web.config;

import com.wotb.web.util.apierror.ApiErrorFactory;
import com.wotb.web.util.apierror.ApiErrorWriter;
import com.wotb.web.util.apierror.CanonicalAccessDeniedHandler;
import com.wotb.web.util.apierror.CanonicalAuthenticationEntryPoint;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
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

import static com.wotb.web.config.ApiPaths.ADMIN_PATTERN;
import static com.wotb.web.config.ApiPaths.ADMIN_USERS_PATTERN;
import static com.wotb.web.config.ApiPaths.API_PATTERN;
import static com.wotb.web.config.ApiPaths.HEALTH;
import static com.wotb.web.config.ApiPaths.HOF_ADMIN_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_HUNDRED_SUBMISSIONS_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_MARK3_SUBMISSIONS_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_REPLAY_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_UPLOAD;
import static com.wotb.web.config.ApiPaths.TOURNAMENTS_ADMIN_PATTERN;
import static com.wotb.web.config.ApiPaths.USERS_PATTERN;

/**
 * 安全配置: Keycloak JWT 认证 + 角色授权。
 * 权限层级:
 *   wotbtools-admin   → Keycloak composite super-admin（继承各领域管理员角色）
 *   tournament-admin → 积分赛管理接口
 *   HoF-admin        → 名人堂管理接口
 *   已登录用户         → 玩家接口
 *   匿名用户           → 公开接口
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(final HttpSecurity http,
                                           final ApiErrorFactory errorFactory,
                                           final ApiErrorWriter errorWriter) {
        final CanonicalAuthenticationEntryPoint authenticationEntryPoint =
                new CanonicalAuthenticationEntryPoint(errorFactory, errorWriter);
        final CanonicalAccessDeniedHandler accessDeniedHandler =
                new CanonicalAccessDeniedHandler(errorFactory, errorWriter);
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .oauth2ResourceServer(rs -> rs.jwt(jwt -> jwt
                .jwtAuthenticationConverter(jwtAuthenticationConverter())
            ).authenticationEntryPoint(authenticationEntryPoint)
              .accessDeniedHandler(accessDeniedHandler))
            .exceptionHandling(errors -> errors
                .authenticationEntryPoint(authenticationEntryPoint)
                .accessDeniedHandler(accessDeniedHandler))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HEALTH).permitAll()
                .requestMatchers(HttpMethod.GET, ApiPaths.TOURNAMENTS, ApiPaths.TOURNAMENT_STANDINGS).permitAll()
                .requestMatchers(HOF_UPLOAD, HOF_REPLAY_PATTERN).authenticated()
                .requestMatchers(HOF_HUNDRED_SUBMISSIONS_PATTERN).authenticated()
                .requestMatchers(HOF_MARK3_SUBMISSIONS_PATTERN).authenticated()
                .requestMatchers(HOF_PATTERN).permitAll()

                .requestMatchers(ADMIN_USERS_PATTERN)
                    .hasRole("wotbtools-admin")

                .requestMatchers(HOF_ADMIN_PATTERN)
                    .hasAnyRole("HoF-admin", "wotbtools-admin")

                .requestMatchers(TOURNAMENTS_ADMIN_PATTERN)
                    .hasRole("tournament-admin")

                .requestMatchers(ADMIN_PATTERN)
                    .hasRole("wotbtools-admin")

                .requestMatchers(USERS_PATTERN)
                    .authenticated()

                .requestMatchers(API_PATTERN).denyAll()
                .anyRequest().permitAll()
            );
        return http.build();
    }

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
