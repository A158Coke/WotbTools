package com.wotbtools.keycloak.wargaming;

import org.keycloak.broker.provider.AbstractIdentityProviderFactory;
import org.keycloak.models.IdentityProviderModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.provider.ProviderConfigProperty;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public final class WargamingIdentityProviderFactory
        extends AbstractIdentityProviderFactory<WargamingIdentityProvider> {

    public static final String PROVIDER_ID = "wargaming";

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getName() {
        return "Wargaming.net";
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
        final ProviderConfigProperty region = new ProviderConfigProperty();
        region.setName(WargamingIdentityProviderConfig.REGION_CONFIG_KEY);
        region.setLabel("Region");
        region.setHelpText("Wargaming.net server region. Each region maps to its official API host.");
        region.setType(ProviderConfigProperty.LIST_TYPE);
        region.setDefaultValue(WargamingRegion.ASIA.name());
        region.setOptions(Arrays.stream(WargamingRegion.values())
                .map(WargamingRegion::name)
                .collect(Collectors.toList()));
        return List.of(region);
    }
}
