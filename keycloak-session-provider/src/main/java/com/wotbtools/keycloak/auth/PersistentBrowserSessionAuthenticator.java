package com.wotbtools.keycloak.auth;

import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.events.Details;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

public final class PersistentBrowserSessionAuthenticator implements Authenticator {

    static final String WEB_CLIENT_ID = "wotbtools-web";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        var authenticationSession = context.getAuthenticationSession();
        var client = authenticationSession.getClient();

        if (client != null && shouldRemember(client.getClientId())) {
            authenticationSession.setAuthNote(Details.REMEMBER_ME, Boolean.TRUE.toString());
        }

        context.success();
    }

    static boolean shouldRemember(String clientId) {
        return WEB_CLIENT_ID.equals(clientId);
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        context.success();
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
    }

    @Override
    public void close() {
    }
}
