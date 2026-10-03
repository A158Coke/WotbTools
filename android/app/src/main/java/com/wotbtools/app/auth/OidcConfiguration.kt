package com.wotbtools.app.auth

/**
 * OIDC 静态配置 —— issuer / clientId / redirect URI / scope 的**唯一** Kotlin 事实源。
 *
 * wire 事实源是 `contracts/android-native-bridge.json`（bridge 方法名与字段）；本文件只承载
 * 「连哪个 Keycloak、用什么 client、走哪条回程」这些 Keycloak 侧配置，两者不重叠。
 *
 * 两条 redirect URI 都必须同时登记在 Keycloak client（`infra/tofu/keycloak/client.tf`）与
 * `AndroidManifest.xml` 的接收 activity 上；任何一条漂移都会让回程落到浏览器里而不是 App。
 */
internal object OidcConfiguration {

    /** Keycloak realm issuer：discovery 文档落在 `<issuer>/.well-known/openid-configuration`。 */
    internal const val ISSUER = "https://auth.wotbtools.com/realms/wotbtools"

    /** PUBLIC client（无 client secret）：Native 是公共客户端，只能靠 PKCE 证明持有者。 */
    internal const val CLIENT_ID = "wotbtools-android"

    /** 首选回程：HTTPS App Link（`autoVerify` + assetlinks.json 指纹），只在**已验证可用**时使用。 */
    internal const val HTTPS_REDIRECT_URI = "https://auth.wotbtools.com/android/oauth/callback"

    /** 回退回程：private-use URI scheme（RFC 8252 §7.1），不依赖 domain verification。 */
    internal const val PRIVATE_REDIRECT_URI = "com.wotbtools.app:/oauth2redirect"

    /** request scope（以空格分隔的 wire 形状）。 */
    internal const val SCOPE = "openid profile email"

    /**
     * 归一化 redirect URI 以便比较：去首尾空白 + 去尾部 `/`。
     *
     * 只做**形状归一化**，不做大小写折叠 —— 两条合法回程里唯一可能出现的大小写差异在 scheme
     * （`com.wotbtools.app` 恒小写），而 HTTPS 回程的 authority 由 AppAuth 原样传递。比较语义是
     * 「是不是同一份配置出来的字符串」，任何改写都可能把一次真实漂移掩盖掉。
     */
    internal fun normalizeRedirectUri(redirectUri: String?): String? =
        redirectUri?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() }

    /** 日志用的安全分类：只暴露传输形态（https / private-scheme），绝不落完整 URI。 */
    internal fun redirectCategory(redirectUri: String?): String {
        val normalized = redirectUri?.trim()?.lowercase(java.util.Locale.ROOT) ?: return "none"
        return when {
            normalized.startsWith("https://") -> "https"
            normalized.contains(":/") -> "private-scheme"
            else -> "unknown"
        }
    }
}
