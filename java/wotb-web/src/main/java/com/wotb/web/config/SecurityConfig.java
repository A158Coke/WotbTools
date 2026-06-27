package com.wotb.web.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/**
 * 测试阶段：放行所有请求。后续逐步收紧为 /api/me 等需要认证。
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(final HttpSecurity http)  {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .anyRequest().permitAll()
            );
        // 测试阶段不启用 OAuth2 Resource Server
        // 后续改为:
        // .oauth2ResourceServer(rs -> rs.jwt(Customizer.withDefaults()))
        // .authorizeHttpRequests(auth -> auth
        //     .requestMatchers("/api/me/**").authenticated()
        //     .anyRequest().permitAll()
        // )
        return http.build();
    }
}
