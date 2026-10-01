package com.wotb.ai;

import com.wotb.core.observability.LogContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
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
        http.addFilterAfter(new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(final HttpServletRequest request,
                    final HttpServletResponse response, final FilterChain chain)
                    throws ServletException, IOException {
                final var authentication = SecurityContextHolder.getContext().getAuthentication();
                final String userId = authentication instanceof JwtAuthenticationToken jwt
                        && jwt.isAuthenticated() ? jwt.getToken().getSubject() : null;
                try (final var ignored = LogContext.with("userId", userId)) {
                    chain.doFilter(request, response);
                }
            }
        }, BearerTokenAuthenticationFilter.class);
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
