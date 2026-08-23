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

import static com.wotb.web.config.ApiPaths.ADMIN_BOOST_PATTERN;
import static com.wotb.web.config.ApiPaths.ADMIN_PATTERN;
import static com.wotb.web.config.ApiPaths.ADMIN_USERS_PATTERN;
import static com.wotb.web.config.ApiPaths.API_PATTERN;
import static com.wotb.web.config.ApiPaths.BOOSTER_PATTERN;
import static com.wotb.web.config.ApiPaths.BOOST_BOOSTER_APPLICATIONS_PATTERN;
import static com.wotb.web.config.ApiPaths.BOOST_BOOSTERS_PATTERN;
import static com.wotb.web.config.ApiPaths.BOOST_LEGACY;
import static com.wotb.web.config.ApiPaths.BOOST_LEGACY_PATTERN;
import static com.wotb.web.config.ApiPaths.BOOST_OPTIONS;
import static com.wotb.web.config.ApiPaths.BOOST_REQUESTS_PATTERN;
import static com.wotb.web.config.ApiPaths.COLUMNS;
import static com.wotb.web.config.ApiPaths.EXPORT;
import static com.wotb.web.config.ApiPaths.HEALTH;
import static com.wotb.web.config.ApiPaths.HOF_ADMIN_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_HUNDRED_SUBMISSIONS_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_REPLAY_PATTERN;
import static com.wotb.web.config.ApiPaths.HOF_UPLOAD;
import static com.wotb.web.config.ApiPaths.PREVIEW;
import static com.wotb.web.config.ApiPaths.REPLAY_ANALYZE;
import static com.wotb.web.config.ApiPaths.REPLAY_ANALYZE_CANCEL;
import static com.wotb.web.config.ApiPaths.REPLAY_MAP_OVERVIEW;
import static com.wotb.web.config.ApiPaths.REPLAY_PROCESS;
import static com.wotb.web.config.ApiPaths.REPLAY_RECONSTRUCT_BATCH;
import static com.wotb.web.config.ApiPaths.USERS_PATTERN;

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
                .requestMatchers(BOOST_OPTIONS).permitAll()
                .requestMatchers(HEALTH, COLUMNS,
                        PREVIEW, EXPORT).permitAll()
                // 名人堂查询公开；上传/下载需登录（必须置于 HOF_PATTERN permitAll 之前）
                .requestMatchers(HOF_UPLOAD, HOF_REPLAY_PATTERN).authenticated()
                // 百场：排行榜公开；提交/取消需登录（必须置于 HOF_PATTERN permitAll 之前）
                .requestMatchers(HOF_HUNDRED_SUBMISSIONS_PATTERN).authenticated()
                .requestMatchers(HOF_PATTERN).permitAll()

                // --- AI 复盘与批量处理 (wotbtools-user / wotbtools-admin) ---
                .requestMatchers(REPLAY_RECONSTRUCT_BATCH,
                        REPLAY_PROCESS,
                        REPLAY_ANALYZE,
                        REPLAY_ANALYZE_CANCEL,
                        REPLAY_MAP_OVERVIEW)
                    .hasAnyRole("wotbtools-user", "wotbtools-admin")

                // --- 管理员用户管理 (仅 wotbtools-admin) ---
                .requestMatchers(ADMIN_USERS_PATTERN)
                    .hasRole("wotbtools-admin")

                // --- 打手管理（boost-manager 仅可访问该域） ---
                .requestMatchers(ADMIN_BOOST_PATTERN)
                    .hasAnyRole("wotbtools-admin", "boost-manager")

                // --- 名人堂管理（HoF-admin 或 wotbtools-admin；必须置于 ADMIN_PATTERN 之前） ---
                .requestMatchers(HOF_ADMIN_PATTERN)
                    .hasAnyRole("HoF-admin", "wotbtools-admin")

                // --- 其他管理员接口仅超级管理员 ---
                .requestMatchers(ADMIN_PATTERN)
                    .hasRole("wotbtools-admin")

                // --- 需登录接口 (wotbtools-admin 也是已登录用户，自动通过) ---
                .requestMatchers(USERS_PATTERN,
                        BOOST_REQUESTS_PATTERN,
                        BOOST_BOOSTERS_PATTERN,
                        BOOST_BOOSTER_APPLICATIONS_PATTERN,
                        BOOSTER_PATTERN,
                        BOOST_LEGACY, BOOST_LEGACY_PATTERN)
                    .authenticated()

                // --- 未显式声明的 API 默认拒绝；静态资源放行 ---
                .requestMatchers(API_PATTERN).denyAll()
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