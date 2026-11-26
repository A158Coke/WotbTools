package com.wotb.web.config;

import jakarta.ws.rs.core.Response;
import org.keycloak.admin.client.Keycloak;
import org.keycloak.admin.client.resource.UsersResource;
import org.keycloak.representations.idm.FederatedIdentityRepresentation;
import org.keycloak.representations.idm.RoleRepresentation;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
public class KeycloakAdminUserService {

    private final Keycloak keycloak;
    private final String realm;

    public KeycloakAdminUserService(final Keycloak keycloak,
                                    @Value("${keycloak.admin.realm}") final String realm) {
        this.keycloak = keycloak;
        this.realm = realm;
    }

    public UserRepresentation getUser(final String keycloakUserId) {
        try {
            return keycloak.realm(realm).users().get(keycloakUserId).toRepresentation();
        } catch (final jakarta.ws.rs.NotFoundException e) {
            return null;
        }
    }

    public List<FederatedIdentityRepresentation> getFederatedIdentities(final String keycloakUserId) {
        try {
            return keycloak.realm(realm).users().get(keycloakUserId).getFederatedIdentity();
        } catch (final jakarta.ws.rs.NotFoundException e) {
            return List.of();
        }
    }

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

    public void addRealmRole(final String keycloakUserId, final String roleName) {
        try {
            final RoleRepresentation role = keycloak.realm(realm).roles().get(roleName).toRepresentation();
            keycloak.realm(realm).users().get(keycloakUserId).roles().realmLevel().add(List.of(role));
        } catch (final jakarta.ws.rs.NotFoundException e) {
            throw new IllegalArgumentException("KEYCLOAK_USER_OR_ROLE_NOT_FOUND", e);
        }
    }

    public void removeRealmRole(final String keycloakUserId, final String roleName) {
        try {
            final RoleRepresentation role = keycloak.realm(realm).roles().get(roleName).toRepresentation();
            keycloak.realm(realm).users().get(keycloakUserId).roles().realmLevel().remove(List.of(role));
        } catch (final jakarta.ws.rs.NotFoundException e) {
            throw new IllegalArgumentException("KEYCLOAK_USER_OR_ROLE_NOT_FOUND", e);
        }
    }

    /**
     * 分页检索 Keycloak realm 用户。
     *
     * <p>分页权威在 Keycloak 侧（first/max），本地不得在内存里二次分页。
     * {@code briefRepresentation=true} 只省掉 attributes 等重字段，username/email/enabled 仍在。</p>
     *
     * @param query 自由文本；空串按无过滤处理
     * @param first 起始下标（0-based）
     * @param max   单页最多条数
     */
    public List<UserRepresentation> searchUsers(final String query, final int first, final int max) {
        final UsersResource users = keycloak.realm(realm).users();
        return StringUtils.hasText(query)
                ? users.search(query.trim(), first, max, true)
                : users.list(first, max);
    }

    public int countUsers(final String query) {
        final Integer count = StringUtils.hasText(query)
                ? keycloak.realm(realm).users().count(query.trim())
                : keycloak.realm(realm).users().count();
        return count == null ? 0 : count;
    }

    public List<UserRepresentation> searchUsersByIdpAlias(final String idpAlias,
                                                          final String usernameQuery,
                                                          final int first,
                                                          final int max) {
        return keycloak.realm(realm).users().search(
                StringUtils.hasText(usernameQuery) ? usernameQuery.trim() : null,
                null, null, null, null,
                idpAlias, null,
                first, max, null, true);
    }

    public int countUsersByIdpAlias(final String idpAlias, final String usernameQuery) {
        final Integer count = keycloak.realm(realm).users().count(
                null, null, null, null, null,
                StringUtils.hasText(usernameQuery) ? usernameQuery.trim() : null,
                null, idpAlias, null, null);
        return count == null ? 0 : count;
    }

    public void deleteUser(final String keycloakUserId) {
        try (Response response = keycloak.realm(realm).users().delete(keycloakUserId)) {
            final int status = response.getStatus();
            if ((status < 200 || status >= 300)
                    && status != Response.Status.NOT_FOUND.getStatusCode()) {
                throw new IllegalStateException("KEYCLOAK_USER_DELETE_FAILED_" + status);
            }
        } catch (final jakarta.ws.rs.NotFoundException e) {
        }
    }
}
