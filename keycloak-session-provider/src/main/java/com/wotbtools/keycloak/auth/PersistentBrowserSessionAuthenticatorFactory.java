package com.wotbtools.keycloak.auth;

import java.util.List;

import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

public final class PersistentBrowserSessionAuthenticatorFactory implements AuthenticatorFactory {

    public static final String ID = "wotbtools-persistent-browser-session";

    private static final PersistentBrowserSessionAuthenticator SINGLETON =
            new PersistentBrowserSessionAuthenticator();

    private static final AuthenticationExecutionModel.Requirement[] REQUIREMENTS = {
        AuthenticationExecutionModel.Requirement.REQUIRED,
        AuthenticationExecutionModel.Requirement.DISABLED
    };

    @Override
    public Authenticator create(KeycloakSession session) {
        return SINGLETON;
    }

    @Override
    public String getId() {
        return ID;
    }

    @Override
    public String getReferenceCategory() {
        return "session";
    }

    @Override
    public boolean isConfigurable() {
        return false;
    }

    @Override
    public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
        return REQUIREMENTS;
    }

    @Override
    public String getDisplayType() {
        return "WotBTools Persistent Browser Session";
    }

    @Override
    public String getHelpText() {
        return "Marks brokered wotbtools-web authentication sessions as remember-me before the user session is attached.";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return List.of();
    }

    @Override
    public boolean isUserSetupAllowed() {
        return false;
    }

    @Override
    public void init(Config.Scope config) {
        // No configuration.
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // No initialization.
    }

    @Override
    public void close() {
        // Stateless.
    }
}
