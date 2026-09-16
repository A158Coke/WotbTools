package com.wotbtools.app

import java.util.Locale

/**
 * Verified QQ broker return classification — a narrow routing boundary only.
 *
 * Purpose: hand the Keycloak broker callback that QQ native login must return to back into the
 * original WebView (via Verified App Link). This object accepts ONLY the two exact QQ broker
 * callback paths; it validates callback shape while Keycloak remains the auth authority.
 *
 * Kept free of Android framework types so it stays a plain JVM unit test (runs under
 * testDebugUnitTest without Robolectric). MainActivity extracts the primitive fields from the
 * incoming Uri and delegates here.
 */
internal object AuthReturnPolicy {

    private const val EXPECTED_SCHEME = "https"
    private const val EXPECTED_HOST = "auth.wotbtools.com"
    private val EXPECTED_PATHS = setOf(
        "/realms/wotbtools/broker/idp-qq/endpoint",
        "/realms/wotbtools/broker/juhe-qq/endpoint"
    )

    /**
     * Returns true only when ALL hold:
     *  - scheme == https
     *  - host == auth.wotbtools.com
     *  - path is one of the two supported aliases (exact, no prefix / suffix)
     *  - state present (non-blank)
     *  - idp-qq: either a successful OAuth code or a provider error is present
     *  - juhe-qq: the existing `type=qq` + one-time `ticket` bridge contract is present
     *
     * state / code contents are never interpreted here; Keycloak validates them.
     */
    fun isVerifiedBrokerReturn(
        scheme: String?,
        host: String?,
        path: String?,
        hasState: Boolean,
        hasCode: Boolean,
        hasError: Boolean = false,
        type: String? = null,
        hasTicket: Boolean = false
    ): Boolean {
        if (EXPECTED_SCHEME != scheme?.lowercase(Locale.ROOT)) return false
        if (EXPECTED_HOST != host?.lowercase(Locale.ROOT)) return false
        if (path == null || path !in EXPECTED_PATHS) return false
        if (!hasState) return false
        if (path.endsWith("/juhe-qq/endpoint")) {
            return type == "qq" && hasTicket && hasCode && !hasError
        }
        // OAuth success and error callbacks are mutually exclusive; both carry state.
        return hasCode xor hasError
    }

    /** Compatibility overload for callers that still pass the legacy type before state/code. */
    @Suppress("UNUSED_PARAMETER")
    fun isVerifiedBrokerReturn(
        scheme: String?,
        host: String?,
        path: String?,
        type: String?,
        hasState: Boolean,
        hasCode: Boolean
    ): Boolean = isVerifiedBrokerReturn(scheme, host, path, hasState, hasCode, type = type, hasTicket = true)
}
