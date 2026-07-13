package com.wotb.web.admin.service;

import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;
import org.keycloak.admin.client.Keycloak;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.RETURNS_DEEP_STUBS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class KeycloakAdminUserServiceTest {

    @Test
    void addRealmRoleShouldPropagateMissingUserOrRole() {
        final Keycloak keycloak = mock(Keycloak.class, RETURNS_DEEP_STUBS);
        final KeycloakAdminUserService service = new KeycloakAdminUserService(keycloak, "realm");
        when(keycloak.realm("realm").roles().get("booster").toRepresentation())
                .thenThrow(new NotFoundException());

        assertThatThrownBy(() -> service.addRealmRole("kc-user", "booster"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("KEYCLOAK_USER_OR_ROLE_NOT_FOUND");
    }

    @Test
    void removeRealmRoleShouldPropagateMissingUserOrRole() {
        final Keycloak keycloak = mock(Keycloak.class, RETURNS_DEEP_STUBS);
        final KeycloakAdminUserService service = new KeycloakAdminUserService(keycloak, "realm");
        when(keycloak.realm("realm").roles().get("booster").toRepresentation())
                .thenThrow(new NotFoundException());

        assertThatThrownBy(() -> service.removeRealmRole("kc-user", "booster"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("KEYCLOAK_USER_OR_ROLE_NOT_FOUND");
    }

    @Test
    void deleteUserShouldCloseSuccessfulResponse() {
        final Keycloak keycloak = mock(Keycloak.class, RETURNS_DEEP_STUBS);
        final Response response = mock(Response.class);
        final KeycloakAdminUserService service = new KeycloakAdminUserService(keycloak, "realm");
        when(keycloak.realm("realm").users().delete("kc-user")).thenReturn(response);
        when(response.getStatus()).thenReturn(Response.Status.NO_CONTENT.getStatusCode());

        assertThatCode(() -> service.deleteUser("kc-user")).doesNotThrowAnyException();

        verify(response).close();
    }

    @Test
    void deleteUserShouldTreatNotFoundResponseAsSuccess() {
        final Keycloak keycloak = mock(Keycloak.class, RETURNS_DEEP_STUBS);
        final Response response = mock(Response.class);
        final KeycloakAdminUserService service = new KeycloakAdminUserService(keycloak, "realm");
        when(keycloak.realm("realm").users().delete("kc-user")).thenReturn(response);
        when(response.getStatus()).thenReturn(Response.Status.NOT_FOUND.getStatusCode());

        assertThatCode(() -> service.deleteUser("kc-user")).doesNotThrowAnyException();

        verify(response).close();
    }

    @Test
    void deleteUserShouldRejectAndCloseFailedResponse() {
        final Keycloak keycloak = mock(Keycloak.class, RETURNS_DEEP_STUBS);
        final Response response = mock(Response.class);
        final KeycloakAdminUserService service = new KeycloakAdminUserService(keycloak, "realm");
        when(keycloak.realm("realm").users().delete("kc-user")).thenReturn(response);
        when(response.getStatus()).thenReturn(Response.Status.INTERNAL_SERVER_ERROR.getStatusCode());

        assertThatThrownBy(() -> service.deleteUser("kc-user"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("KEYCLOAK_USER_DELETE_FAILED_500");

        verify(response).close();
    }
}
