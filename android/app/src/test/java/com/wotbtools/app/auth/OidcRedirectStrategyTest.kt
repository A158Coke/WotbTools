package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class OidcRedirectStrategyTest {

    @Test
    fun redirectIsAlwaysThePrivateScheme() {
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, OidcRedirectStrategy.decide(appLinkUsable = true))
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, OidcRedirectStrategy.decide(appLinkUsable = false))
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, OidcRedirectStrategy.redirectUri())
    }

    @Test
    fun httpsRedirectRemainsRegisteredAsCompatFallback() {
        assertEquals("https://auth.wotbtools.com/android/oauth/callback", OidcConfiguration.HTTPS_REDIRECT_URI)
        assertEquals("auth.wotbtools.com", OidcRedirectStrategy.APP_LINK_HOST)
    }

    @Test
    fun theTwoTransportsAreDistinctAndCorrectlyShaped() {
        assertNotEquals(OidcConfiguration.HTTPS_REDIRECT_URI, OidcConfiguration.PRIVATE_REDIRECT_URI)
        assertEquals("com.wotbtools.app:/oauth2redirect", OidcConfiguration.PRIVATE_REDIRECT_URI)
    }

    @Test
    fun redirectNormalisationOnlyTrimsSlashAndWhitespace() {
        assertEquals("https://a/b", OidcConfiguration.normalizeRedirectUri(" https://a/b/ "))
        assertEquals("https://a/b", OidcConfiguration.normalizeRedirectUri("https://a/b"))
        assertEquals(null, OidcConfiguration.normalizeRedirectUri("   "))
        assertEquals(null, OidcConfiguration.normalizeRedirectUri(null))
        assertEquals("HTTPS://A/B", OidcConfiguration.normalizeRedirectUri("HTTPS://A/B"))
    }

    @Test
    fun redirectCategoryNeverLeaksTheUri() {
        assertEquals("https", OidcConfiguration.redirectCategory(OidcConfiguration.HTTPS_REDIRECT_URI))
        assertEquals("private-scheme", OidcConfiguration.redirectCategory(OidcConfiguration.PRIVATE_REDIRECT_URI))
        assertEquals("none", OidcConfiguration.redirectCategory(null))
        assertEquals("unknown", OidcConfiguration.redirectCategory("garbage"))
    }

    @Test
    fun oidcStaticConfigurationMatchesTheKeycloakClient() {
        assertEquals("https://auth.wotbtools.com/realms/wotbtools", OidcConfiguration.ISSUER)
        assertEquals("wotbtools-android", OidcConfiguration.CLIENT_ID)
        assertEquals("openid profile email", OidcConfiguration.SCOPE)
    }
}
