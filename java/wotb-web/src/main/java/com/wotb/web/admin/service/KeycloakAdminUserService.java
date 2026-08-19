package com.wotb.web.admin.service;

import jakarta.ws.rs.core.Response;
import org.keycloak.admin.client.Keycloak;
import org.keycloak.representations.idm.FederatedIdentityRepresentation;
import org.keycloak.representations.idm.RoleRepresentation;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;

/** 通过 Keycloak Admin API 查询/删除用户并管理 realm role。 */
@Service
public class KeycloakAdminUserService {

    private final Keycloak keycloak;
    private final String realm;

    public KeycloakAdminUserService(final Keycloak keycloak,
                                    @Value("${keycloak.admin.realm}") final String realm) {
        this.keycloak = keycloak;
        this.realm = realm;
    }

    /** 查询 Keycloak 用户详情，用户不存在时返回 null。 */
    public UserRepresentation getUser(final String keycloakUserId) {
        try {
            return keycloak.realm(realm).users().get(keycloakUserId).toRepresentation();
        } catch (final jakarta.ws.rs.NotFoundException e) {
            return null;
        }
    }

    /** 获取 Keycloak 用户的联合身份（federated identities）。 */
    public List<FederatedIdentityRepresentation> getFederatedIdentities(final String keycloakUserId) {
        try {
            return keycloak.realm(realm).users().get(keycloakUserId).getFederatedIdentity();
        } catch (final jakarta.ws.rs.NotFoundException e) {
            return List.of();
        }
    }

    /** 查询用户是否已分配指定 realm role。 */
    public boolean hasRealmRole(final String keycloakUserId, final String roleName) {
        try {
            final List<RoleRepresentation> roles = keycloak.realm(realm)
                    .users()
                    .get(keycloakUserId)
                    .roles()
                    .realmLevel()
                    .listAll();
            return roles != null && roles.stream()
                    .map(RoleRepresentation::getName)
                    .anyMatch(roleName::equals);
        } catch (final jakarta.ws.rs.NotFoundException e) {
            throw new IllegalArgumentException("KEYCLOAK_USER_NOT_FOUND", e);
        }
    }

    /** 给 Keycloak 用户分配 realm role。 */
    public void addRealmRole(final String keycloakUserId, final String roleName) {
        try {
            final RoleRepresentation role = keycloak.realm(realm).roles().get(roleName).toRepresentation();
            keycloak.realm(realm).users().get(keycloakUserId).roles().realmLevel().add(List.of(role));
        } catch (final jakarta.ws.rs.NotFoundException e) {
            throw new IllegalArgumentException("KEYCLOAK_USER_OR_ROLE_NOT_FOUND", e);
        }
    }

    /** 移除 Keycloak 用户的 realm role。 */
    public void removeRealmRole(final String keycloakUserId, final String roleName) {
        try {
            final RoleRepresentation role = keycloak.realm(realm).roles().get(roleName).toRepresentation();
            keycloak.realm(realm).users().get(keycloakUserId).roles().realmLevel().remove(List.of(role));
        } catch (final jakarta.ws.rs.NotFoundException e) {
            throw new IllegalArgumentException("KEYCLOAK_USER_OR_ROLE_NOT_FOUND", e);
        }
    }

    /** 删除 Keycloak 用户。用户不存在时不抛异常。 */
    public void deleteUser(final String keycloakUserId) {
        try (Response response = keycloak.realm(realm).users().delete(keycloakUserId)) {
            final int status = response.getStatus();
            if ((status < 200 || status >= 300)
                    && status != Response.Status.NOT_FOUND.getStatusCode()) {
                throw new IllegalStateException("KEYCLOAK_USER_DELETE_FAILED_" + status);
            }
        } catch (final jakarta.ws.rs.NotFoundException e) {
            // 用户已在 Keycloak 侧被删除，视为成功
        }
    }
}
