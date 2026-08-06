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
        assertEquals("https://api.wotblitz.asia/wot/auth/",
                WargamingRegion.ASIA.authBase().toString());
        assertEquals("https://api.wotblitz.asia/wotb/account/",
                WargamingRegion.ASIA.accountBase().toString());
        assertEquals("https://api.wotblitz.eu/wot/auth/",
                WargamingRegion.EU.authBase().toString());
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
