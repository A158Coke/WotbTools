package com.wotbtools.keycloak.wargaming;

import java.net.URI;
import java.util.Locale;

enum WargamingRegion {

    ASIA("asia", "api.worldoftanks.asia", "api.wotblitz.asia"),
    EU("eu", "api.worldoftanks.eu", "api.wotblitz.eu"),
    NA("na", "api.worldoftanks.com", "api.wotblitz.com");

    private final String key;
    private final String authHost;
    private final String accountHost;

    WargamingRegion(final String key, final String authHost, final String accountHost) {
        this.key = key;
        this.authHost = authHost;
        this.accountHost = accountHost;
    }

    String key() {
        return key;
    }

    String authHost() {
        return authHost;
    }

    String accountHost() {
        return accountHost;
    }

    URI authBase() {
        return URI.create("https://" + authHost + "/wot/auth/");
    }

    URI accountBase() {
        return URI.create("https://" + accountHost + "/wotb/account/");
    }

    static WargamingRegion fromKey(final String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        final String normalized = value.trim().toUpperCase(Locale.ROOT);
        for (final WargamingRegion region : values()) {
            if (region.name().equals(normalized)) {
                return region;
            }
        }
        return null;
    }
}
