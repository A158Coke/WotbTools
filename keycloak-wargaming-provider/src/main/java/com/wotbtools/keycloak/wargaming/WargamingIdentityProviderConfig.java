package com.wotbtools.keycloak.wargaming;

import org.keycloak.models.IdentityProviderModel;

public final class WargamingIdentityProviderConfig extends IdentityProviderModel {

    public static final String REGION_CONFIG_KEY = "region";

    public WargamingIdentityProviderConfig() {
    }

    public WargamingIdentityProviderConfig(final IdentityProviderModel model) {
        super(model);
    }

    public WargamingRegion region() {
        final WargamingRegion region = WargamingRegion.fromKey(getConfig().get(REGION_CONFIG_KEY));
        return region != null ? region : WargamingRegion.ASIA;
    }
}
