package com.wotbtools.app

import java.util.Locale

/** The action MainActivity should take for a top-level navigation. */
internal enum class AuthNavigationAction {
    ALLOW_WEBVIEW,
    ALLOW_AUTH_WEBVIEW,
    OPEN_EXTERNAL
}

/** Navigation action plus the auth-flow state to retain for the next navigation. */
internal data class AuthNavigationDecision(
    val action: AuthNavigationAction,
    val inAuthFlow: Boolean
)

/**
 * Single source of truth for Android's top-level authentication navigation boundary.
 *
 * Provider hosts are exact entries. They are never trusted by suffix or wildcard matching.
 */
internal object AuthNavigationPolicy {
    internal val APP_HOSTS = setOf(
        "wotbtools.com",
        "www.wotbtools.com"
    )

    internal val KEYCLOAK_HOSTS = setOf(
        "auth.wotbtools.com"
    )

    /** Evidence-backed provider hosts; extend only with verified top-level auth navigation. */
    internal val AUTH_PROVIDER_HOSTS = setOf(
        "graph.qq.com"
    )

    fun decide(host: String?, inAuthFlow: Boolean): AuthNavigationDecision {
        val normalizedHost = normalizeHost(host)
            ?: return AuthNavigationDecision(AuthNavigationAction.ALLOW_WEBVIEW, false)

        return when {
            normalizedHost in APP_HOSTS ->
                AuthNavigationDecision(AuthNavigationAction.ALLOW_WEBVIEW, false)

            normalizedHost in KEYCLOAK_HOSTS ->
                AuthNavigationDecision(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, true)

            normalizedHost in AUTH_PROVIDER_HOSTS && inAuthFlow ->
                AuthNavigationDecision(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, true)

            else ->
                AuthNavigationDecision(AuthNavigationAction.OPEN_EXTERNAL, false)
        }
    }

    private fun normalizeHost(host: String?): String? = host
        ?.trim()
        ?.trimEnd('.')
        ?.takeIf { it.isNotEmpty() }
        ?.lowercase(Locale.ROOT)
}
