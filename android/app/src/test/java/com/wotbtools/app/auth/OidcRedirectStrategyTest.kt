package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * [OidcRedirectStrategy] 的纯决策测试。
 *
 * Android 侧的 domain verification 探测（API 31+ 平台调用）刻意不做 JVM 测试：那是平台 API，
 * 只能真机验证。这里固定的是「探测结果 → 用哪条回程」这条纯规则，以及它与 Keycloak /
 * AndroidManifest 必须逐字一致的两个 URI 字面量。
 */
class OidcRedirectStrategyTest {

    @Test
    fun verifiedAppLinkUsesHttpsRedirect() {
        assertEquals(OidcConfiguration.HTTPS_REDIRECT_URI, OidcRedirectStrategy.decide(appLinkUsable = true))
    }

    @Test
    fun unverifiedAppLinkFallsBackToPrivateScheme() {
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, OidcRedirectStrategy.decide(appLinkUsable = false))
    }

    @Test
    fun theTwoTransportsAreDistinctAndCorrectlyShaped() {
        assertNotEquals(OidcConfiguration.HTTPS_REDIRECT_URI, OidcConfiguration.PRIVATE_REDIRECT_URI)
        // App Link host 必须与 manifest 的 autoVerify filter / assetlinks.json 一致。
        assertEquals("auth.wotbtools.com", OidcRedirectStrategy.APP_LINK_HOST)
        assertEquals(
            "https://${OidcRedirectStrategy.APP_LINK_HOST}/android/oauth/callback",
            OidcConfiguration.HTTPS_REDIRECT_URI
        )
        // private-use URI scheme 必须由 applicationId 派生（manifest placeholder 只取 scheme 段）。
        assertEquals("com.wotbtools.app:/oauth2redirect", OidcConfiguration.PRIVATE_REDIRECT_URI)
    }

    @Test
    fun redirectNormalisationOnlyTrimsSlashAndWhitespace() {
        assertEquals("https://a/b", OidcConfiguration.normalizeRedirectUri(" https://a/b/ "))
        assertEquals("https://a/b", OidcConfiguration.normalizeRedirectUri("https://a/b"))
        // 空 / 纯空白一律 null：调用方据此 fail closed。
        assertEquals(null, OidcConfiguration.normalizeRedirectUri("   "))
        assertEquals(null, OidcConfiguration.normalizeRedirectUri(null))
        // 大小写不折叠：不同字符串就是不同字符串，避免掩盖真实漂移。
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
