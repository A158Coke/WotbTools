package com.wotbtools.app

import java.util.Locale

/**
 * Verified Juhe QQ broker return classification — a narrow routing boundary only.
 *
 * Purpose: hand the Keycloak broker callback that QQ native login must return to back into the
 * original WebView (via Verified App Link). This object accepts ONLY the exact Juhe QQ broker
 * callback path, and does NOT validate the state / code payloads (Keycloak is the auth authority).
 *
 * Kept free of Android framework types so it stays a plain JVM unit test (runs under
 * testDebugUnitTest without Robolectric). MainActivity extracts the primitive fields from the
 * incoming Uri and delegates here.
 */
internal object AuthReturnPolicy {

    private const val EXPECTED_SCHEME = "https"
    private const val EXPECTED_HOST = "auth.wotbtools.com"
    private const val EXPECTED_PATH = "/realms/wotbtools/broker/juhe-qq/endpoint"

    /**
     * Returns true only when ALL hold:
     *  - scheme == https
     *  - host == auth.wotbtools.com
     *  - path == /realms/wotbtools/broker/juhe-qq/endpoint   (exact, no prefix / suffix)
     *  - type == qq
     *  - state present (non-blank)
     *  - code present (non-blank)
     *
     * state / code contents are never interpreted here; Keycloak validates them.
     */
    fun isVerifiedBrokerReturn(
        scheme: String?,
        host: String?,
        path: String?,
        type: String?,
        hasState: Boolean,
        hasCode: Boolean
    ): Boolean {
        if (EXPECTED_SCHEME != scheme?.lowercase(Locale.ROOT)) return false
        if (EXPECTED_HOST != host?.lowercase(Locale.ROOT)) return false
        if (EXPECTED_PATH != path) return false
        if ("qq" != type) return false
        if (!hasState) return false
        if (!hasCode) return false
        return true
    }
}
