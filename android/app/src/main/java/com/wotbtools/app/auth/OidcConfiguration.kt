package com.wotbtools.app.auth

internal object OidcConfiguration {

    internal const val ISSUER = "https://auth.wotbtools.com/realms/wotbtools"

    internal const val CLIENT_ID = "wotbtools-android"

    internal const val HTTPS_REDIRECT_URI = "https://auth.wotbtools.com/android/oauth/callback"

    internal const val PRIVATE_REDIRECT_URI = "com.wotbtools.app:/oauth2redirect"

    internal const val SCOPE = "openid profile email"

    internal fun normalizeRedirectUri(redirectUri: String?): String? =
        redirectUri?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() }

    internal fun redirectCategory(redirectUri: String?): String {
        val normalized = redirectUri?.trim()?.lowercase(java.util.Locale.ROOT) ?: return "none"
        return when {
            normalized.startsWith("https://") -> "https"
            normalized.contains(":/") -> "private-scheme"
            else -> "unknown"
        }
    }
}
