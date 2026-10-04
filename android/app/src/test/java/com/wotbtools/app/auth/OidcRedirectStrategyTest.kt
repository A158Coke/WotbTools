package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * [OidcRedirectStrategy] 的纯决策测试。
 *
 * 2.1.0 起**回程恒为 private scheme**：平台 domain verification 探测已删除，无论探测值
 * 是什么（真实设备上也不再有探测），决策都必须是 private scheme——「某设备 App Link
 * 可用所以走 HTTPS」正是 2.0.x 在异构 ROM 上断回程的根因，这条用例就是它的回归锁。
 * Android 侧的平台调用仍不做 JVM 测试（只能真机验证）；这里固定的是决策规则、与
 * Keycloak / AndroidManifest 必须逐字一致的两个 URI 字面量，以及 fallback 页的触发 URI。
 */
class OidcRedirectStrategyTest {

    @Test
    fun redirectIsAlwaysThePrivateScheme() {
        // 平台状态不再参与决策：verified / unverified 一律 private scheme
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, OidcRedirectStrategy.decide(appLinkUsable = true))
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, OidcRedirectStrategy.decide(appLinkUsable = false))
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, OidcRedirectStrategy.redirectUri())
    }

    @Test
    fun httpsRedirectRemainsRegisteredAsCompatFallback() {
        // HTTPS 回程降级为兼容回退（Keycloak client / manifest filter / Caddy 落地页），
        // 但它必须继续存在且形状不变——fallback 落地页的「返回 App」按钮指向 private scheme。
        assertEquals("https://auth.wotbtools.com/android/oauth/callback", OidcConfiguration.HTTPS_REDIRECT_URI)
        assertEquals("auth.wotbtools.com", OidcRedirectStrategy.APP_LINK_HOST)
    }

    @Test
    fun theTwoTransportsAreDistinctAndCorrectlyShaped() {
        assertNotEquals(OidcConfiguration.HTTPS_REDIRECT_URI, OidcConfiguration.PRIVATE_REDIRECT_URI)
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
