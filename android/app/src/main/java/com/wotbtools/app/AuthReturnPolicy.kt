package com.wotbtools.app

import java.util.Locale

/**
 * Verified QQ broker return classification — a narrow routing boundary only.
 *
 * Purpose: hand the Keycloak broker callback that QQ native login must return to back into the
 * original WebView (via Verified App Link). This object accepts ONLY the exact official QQ broker
 * callback path; it validates callback shape while Keycloak remains the auth authority.
 *
 * Kept free of Android framework types so it stays a plain JVM unit test (runs under
 * testDebugUnitTest without Robolectric). MainActivity extracts the primitive fields from the
 * incoming Uri and delegates here.
 */
internal object AuthReturnPolicy {

    private const val EXPECTED_SCHEME = "https"
    private const val EXPECTED_HOST = "auth.wotbtools.com"
    private const val QQ_BROKER_PATH = "/realms/wotbtools/broker/idp-qq/endpoint"

    /**
     * Returns true only when ALL hold:
     *  - scheme == https
     *  - host == auth.wotbtools.com
     *  - path is the official QQ broker callback (exact, no prefix / suffix)
     *  - state present (non-blank)
     *  - either a successful OAuth code or a provider error is present
     *
     * state / code contents are never interpreted here; Keycloak validates them.
     */
    fun isVerifiedBrokerReturn(
        scheme: String?,
        host: String?,
        path: String?,
        hasState: Boolean,
        hasCode: Boolean,
        hasError: Boolean = false
    ): Boolean {
        if (EXPECTED_SCHEME != scheme?.lowercase(Locale.ROOT)) return false
        if (EXPECTED_HOST != host?.lowercase(Locale.ROOT)) return false
        if (path != QQ_BROKER_PATH) return false
        if (!hasState) return false
        // OAuth success and error callbacks are mutually exclusive; both carry state.
        return hasCode xor hasError
    }
}
