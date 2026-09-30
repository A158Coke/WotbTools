package com.wotb.ai;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.core.convert.converter.Converter;

import java.util.Collection;
import java.util.List;
import java.util.Map;

@Configuration
public class AiServiceSecurityConfig {
    @Bean
    SecurityFilterChain aiSecurityFilterChain(final HttpSecurity http) {
        http.csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .oauth2ResourceServer(resource -> resource.jwt(jwt ->
                        jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health", "/actuator/health/**",
                                "/actuator/prometheus").permitAll()
                        .requestMatchers("/api/ai/**").hasAnyRole("wotbtools-user", "wotbtools-admin")
                        .anyRequest().denyAll());
        return http.build();
    }

    private static Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter() {
        final JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            final Object realm = jwt.getClaim("realm_access");
            if (!(realm instanceof Map<?, ?> values)
                    || !(values.get("roles") instanceof Collection<?> roles)) {
                return List.of();
            }
            return roles.stream().filter(String.class::isInstance).map(String.class::cast)
                    .map(role -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + role))
                    .toList();
        });
        return converter;
    }
}
