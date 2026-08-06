package com.wotbtools.keycloak.wargaming;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class WargamingRegionTest {

    @Test
    void fromKeyIsCaseInsensitiveAndRejectsUnknown() {
        assertEquals(WargamingRegion.ASIA, WargamingRegion.fromKey("ASIA"));
        assertEquals(WargamingRegion.EU, WargamingRegion.fromKey("eu"));
        assertEquals(WargamingRegion.NA, WargamingRegion.fromKey(" Na "));
        assertNull(WargamingRegion.fromKey("SA"));
        assertNull(WargamingRegion.fromKey(null));
        assertNull(WargamingRegion.fromKey(""));
    }

    @Test
    void eachRegionMapsToItsOfficialApiHost() {
        assertEquals("api.worldoftanks.asia", WargamingRegion.ASIA.authHost());
        assertEquals("api.wotblitz.asia", WargamingRegion.ASIA.accountHost());
        assertEquals("https://api.worldoftanks.asia/wot/auth/",
                WargamingRegion.ASIA.authBase().toString());
        assertEquals("https://api.wotblitz.asia/wotb/account/",
                WargamingRegion.ASIA.accountBase().toString());

        assertEquals("api.worldoftanks.eu", WargamingRegion.EU.authHost());
        assertEquals("api.wotblitz.eu", WargamingRegion.EU.accountHost());
        assertEquals("https://api.worldoftanks.eu/wot/auth/",
                WargamingRegion.EU.authBase().toString());
        assertEquals("https://api.wotblitz.eu/wotb/account/",
                WargamingRegion.EU.accountBase().toString());

        assertEquals("api.worldoftanks.com", WargamingRegion.NA.authHost());
        assertEquals("api.wotblitz.com", WargamingRegion.NA.accountHost());
        assertEquals("https://api.worldoftanks.com/wot/auth/",
                WargamingRegion.NA.authBase().toString());
        assertEquals("https://api.wotblitz.com/wotb/account/",
                WargamingRegion.NA.accountBase().toString());
    }

    @Test
    void brokerKeySegmentIsLowercase() {
        assertEquals("asia", WargamingRegion.ASIA.key());
        assertEquals("eu", WargamingRegion.EU.key());
        assertEquals("na", WargamingRegion.NA.key());
    }

    @Test
    void configDefaultsToAsiaWhenRegionMissingOrUnknown() {
        final WargamingIdentityProviderConfig config = new WargamingIdentityProviderConfig();
        assertEquals(WargamingRegion.ASIA, config.region());

        config.getConfig().put(WargamingIdentityProviderConfig.REGION_CONFIG_KEY, "EU");
        assertEquals(WargamingRegion.EU, config.region());

        config.getConfig().put(WargamingIdentityProviderConfig.REGION_CONFIG_KEY, "SA");
        assertEquals(WargamingRegion.ASIA, config.region());
    }
}
