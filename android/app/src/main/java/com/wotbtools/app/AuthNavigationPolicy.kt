package com.wotbtools.app

import java.util.Locale

/** The action MainActivity should take for a top-level navigation. */
internal enum class AuthNavigationAction {
    ALLOW_WEBVIEW,
    ALLOW_AUTH_WEBVIEW,

    /**
     * Auth flow reached a real-device-verified native authentication URI (e.g. QQ
     * `wtloginmqq://ptlogin`). Hand the URI to the corresponding app (ACTION_VIEW) while
     * keeping the current WebView authentication transaction alive (inAuthFlow stays true).
     * Never treated as an ordinary external deep link, and never mixes with the web provider
     * host allowlist.
     */
    NATIVE_AUTH_HANDOFF,
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
 * Web provider hosts are exact entries; native handoff targets are exact (scheme, host)
 * pairs. Entries are never trusted by suffix, wildcard, or scheme-prefix matching.
 */
internal object AuthNavigationPolicy {
    internal val APP_HOSTS = setOf(
        "wotbtools.com",
        "www.wotbtools.com"
    )

    internal val KEYCLOAK_HOSTS = setOf(
        "auth.wotbtools.com"
    )

    /** Evidence-backed web provider hosts; extend only with verified top-level auth navigation. */
    internal val AUTH_PROVIDER_HOSTS = setOf(
        "graph.qq.com",
        "xui.ptlogin2.qq.com"
    )

    /**
     * Real-device-verified native login handoff targets, keyed by exact (scheme, host).
     *
     * Android 1.0.9 ADB evidence: the QQ auth chain reaches `wtloginmqq://ptlogin` after
     * `xui.ptlogin2.qq.com`, and that URI must be handed to the QQ app. Only this exact pair
     * is trusted; `mqq*`, `wtlogin*`, suffix, or any other custom scheme is never added by guess.
     */
    internal val NATIVE_AUTH_TARGETS = setOf(
        "wtloginmqq" to "ptlogin"
    )

    fun decide(scheme: String?, host: String?, inAuthFlow: Boolean): AuthNavigationDecision {
        val normalizedScheme = normalizeScheme(scheme)
        val normalizedHost = normalizeHost(host)

        // Verified native login handoff: exact (scheme, host) pair, only inside an auth flow.
        // Keep inAuthFlow=true so the WebView authentication transaction survives the handoff.
        if (inAuthFlow && normalizedScheme != null && normalizedHost != null &&
            (normalizedScheme to normalizedHost) in NATIVE_AUTH_TARGETS
        ) {
            return AuthNavigationDecision(AuthNavigationAction.NATIVE_AUTH_HANDOFF, true)
        }

        // App host ends the auth flow (successful callback back to the app).
        if (normalizedHost != null && normalizedHost in APP_HOSTS) {
            return AuthNavigationDecision(AuthNavigationAction.ALLOW_WEBVIEW, false)
        }

        if (normalizedHost != null && normalizedHost in KEYCLOAK_HOSTS) {
            return AuthNavigationDecision(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, true)
        }

        if (normalizedHost != null && normalizedHost in AUTH_PROVIDER_HOSTS && inAuthFlow) {
            return AuthNavigationDecision(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, true)
        }

        // Inside the auth flow: any unverified navigation — including a hostless unknown
        // custom scheme — must fail closed. Never OPEN_EXTERNAL here, and never clear the
        // auth-flow marker as part of this decision.
        if (inAuthFlow) {
            return AuthNavigationDecision(AuthNavigationAction.AUTH_FAILURE, true)
        }

        // Non-auth flow: hostless navigation stays in the WebView (no external target to open);
        // ordinary external links (with a host) open outside the WebView.
        return if (normalizedHost == null) {
            AuthNavigationDecision(AuthNavigationAction.ALLOW_WEBVIEW, false)
        } else {
            AuthNavigationDecision(AuthNavigationAction.OPEN_EXTERNAL, false)
        }
    }

    /** Source category for the navigation trace: app / keycloak / auth-provider / auth-provider-native / unknown. */
    internal fun sourceCategory(scheme: String?, host: String?): String {
        val normalizedScheme = normalizeScheme(scheme)
        val normalizedHost = normalizeHost(host)
        if (normalizedScheme != null && normalizedHost != null &&
            (normalizedScheme to normalizedHost) in NATIVE_AUTH_TARGETS
        ) {
            return "auth-provider-native"
        }
        if (normalizedHost == null) return "unknown"
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

    private fun normalizeScheme(scheme: String?): String? = scheme
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.lowercase(Locale.ROOT)
}
