package com.wotbtools.app

import java.util.Locale

/** The action MainActivity should take for a top-level navigation. */
internal enum class AuthNavigationAction {
    ALLOW_WEBVIEW,
    ALLOW_AUTH_WEBVIEW,
    OPEN_EXTERNAL,

    /**
     * Auth flow reached an unverified host. Block the navigation and enter auth-failure
     * recovery: never hand off to the system browser here, and never silently drop the
     * auth-flow marker (recovery is responsible for exiting the flow).
     */
    AUTH_FAILURE
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
        "graph.qq.com",
        "xui.ptlogin2.qq.com"
    )

    fun decide(host: String?, inAuthFlow: Boolean): AuthNavigationDecision {
        val normalizedHost = normalizeHost(host)
            ?: return AuthNavigationDecision(AuthNavigationAction.ALLOW_WEBVIEW, false)

        // App host ends the auth flow (successful callback back to the app).
        if (normalizedHost in APP_HOSTS) {
            return AuthNavigationDecision(AuthNavigationAction.ALLOW_WEBVIEW, false)
        }

        if (normalizedHost in KEYCLOAK_HOSTS) {
            return AuthNavigationDecision(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, true)
        }

        if (normalizedHost in AUTH_PROVIDER_HOSTS && inAuthFlow) {
            return AuthNavigationDecision(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, true)
        }

        // Unverified host inside the auth flow: block and enter recovery. Never OPEN_EXTERNAL
        // here, and never clear the auth-flow marker as part of this decision.
        if (inAuthFlow) {
            return AuthNavigationDecision(AuthNavigationAction.AUTH_FAILURE, true)
        }

        // Non-auth flow: ordinary external links open outside the WebView.
        return AuthNavigationDecision(AuthNavigationAction.OPEN_EXTERNAL, false)
    }

    /** Source category for the navigation trace: app / keycloak / auth-provider / unknown. */
    internal fun sourceCategory(host: String?): String {
        val normalizedHost = normalizeHost(host) ?: return "unknown"
        return when {
            normalizedHost in APP_HOSTS -> "app"
            normalizedHost in KEYCLOAK_HOSTS -> "keycloak"
            normalizedHost in AUTH_PROVIDER_HOSTS -> "auth-provider"
            else -> "unknown"
        }
    }

    private fun normalizeHost(host: String?): String? = host
        ?.trim()
        ?.trimEnd('.')
        ?.takeIf { it.isNotEmpty() }
        ?.lowercase(Locale.ROOT)
}
