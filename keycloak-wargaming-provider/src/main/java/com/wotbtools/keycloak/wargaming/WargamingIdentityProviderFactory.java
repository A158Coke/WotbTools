package com.wotbtools.keycloak.wargaming;

import org.keycloak.broker.provider.AbstractIdentityProviderFactory;
import org.keycloak.models.IdentityProviderModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.provider.ProviderConfigProperty;

import java.util.List;

/**
 * 工厂：Provider id 固定 {@code wargaming-asia}（与前端 idpHint 对齐）。
 * 应用 ID 走环境变量，不在 Admin Console 配置项中维护。
 */
public final class WargamingIdentityProviderFactory
        extends AbstractIdentityProviderFactory<WargamingIdentityProvider> {

    public static final String PROVIDER_ID = "wargaming-asia";

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getName() {
        return "Wargaming.net Asia";
    }

    @Override
    public WargamingIdentityProvider create(final KeycloakSession session,
                                            final IdentityProviderModel model) {
        return new WargamingIdentityProvider(session,
                new WargamingIdentityProviderConfig(model));
    }

    @Override
    public WargamingIdentityProviderConfig createConfig() {
        return new WargamingIdentityProviderConfig();
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return List.of();
    }
}
