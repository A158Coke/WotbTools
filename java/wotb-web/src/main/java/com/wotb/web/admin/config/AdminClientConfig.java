package com.wotb.web.admin.config;

import org.keycloak.admin.client.Keycloak;
import org.keycloak.admin.client.KeycloakBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Keycloak Admin Client 配置。使用服务账号（client_credentials）调 Admin API。 */
@Configuration
public class AdminClientConfig {

    @Bean
    public Keycloak keycloakAdminClient(
            @Value("${keycloak.admin.server-url}") final String serverUrl,
            @Value("${keycloak.admin.realm}") final String realm,
            @Value("${keycloak.admin.client-id}") final String clientId,
            @Value("${keycloak.admin.client-secret}") final String clientSecret) {
        return KeycloakBuilder.builder()
                .serverUrl(serverUrl)
                .realm(realm)
                .clientId(clientId)
                .clientSecret(clientSecret)
                .grantType("client_credentials")
                .build();
    }
}
