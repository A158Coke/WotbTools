package com.wotb.web.admin.service;

import org.keycloak.admin.client.Keycloak;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;

/** 通过 Keycloak Admin API 查询和删除 Keycloak 用户。 */
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
    public List<org.keycloak.representations.idm.FederatedIdentityRepresentation> getFederatedIdentities(
            final String keycloakUserId) {
        try {
            return keycloak.realm(realm).users().get(keycloakUserId).getFederatedIdentity();
        } catch (final jakarta.ws.rs.NotFoundException e) {
            return List.of();
        }
    }

    /** 给 Keycloak 用户分配 realm role。 */
    public void addRealmRole(final String keycloakUserId, final String roleName) {
        try {
            final var role = keycloak.realm(realm).roles().get(roleName).toRepresentation();
            keycloak.realm(realm).users().get(keycloakUserId).roles().realmLevel().add(List.of(role));
        } catch (final jakarta.ws.rs.NotFoundException e) {
            // role 或 user 不存在
        }
    }

    /** 移除 Keycloak 用户的 realm role。 */
    public void removeRealmRole(final String keycloakUserId, final String roleName) {
        try {
            final var role = keycloak.realm(realm).roles().get(roleName).toRepresentation();
            keycloak.realm(realm).users().get(keycloakUserId).roles().realmLevel().remove(List.of(role));
        } catch (final jakarta.ws.rs.NotFoundException e) {
            // role 或 user 不存在
        }
    }

    /** 删除 Keycloak 用户。用户不存在时不抛异常。 */
    public void deleteUser(final String keycloakUserId) {
        try {
            keycloak.realm(realm).users().delete(keycloakUserId);
        } catch (final jakarta.ws.rs.NotFoundException e) {
            // 用户已在 Keycloak 侧被删除，视为成功
        }
    }
}
