package com.wotbtools.app.auth

internal object AuthResponseGuard {

    private val CANCELLED_ERRORS = setOf(
        "access_denied",
        "user_cancelled",
        "user_canceled",
        "login_required"
    )

    internal fun isCancelledProviderError(error: String?): Boolean =
        error?.trim()?.lowercase() in CANCELLED_ERRORS

    /**
     * 校验一次授权响应。
     *
     * @param expectedState 本次交易持久化的 request 的 `state`（我们自己的那份）。
     * @param responseState 响应携带的 `state`。
     * @param expectedRedirectUri 本次交易实际使用的回程 URI（交易开始时选定并随交易持久化）。
     * @param responseRedirectUri 实际收到响应的回程 URI（调用方剥掉 query / fragment 后的形状）。
     * @param code 响应携带的 authorization code（可空）。
     * @param error IdP 返回的 `error`（可空）。
     * @return null 表示「响应确实属于本次交易且形状合法、可以去换 token」；否则是本次失败的显式原因。
     */
    internal fun verify(
        expectedState: String?,
        responseState: String?,
        expectedRedirectUri: String?,
        responseRedirectUri: String?,
        code: String?,
        error: String?
    ): AuthResult.Failure? {
        val expected = expectedState?.takeIf { it.isNotBlank() }
            ?: return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, "missing-expected-state")
        val actual = responseState?.takeIf { it.isNotBlank() }
            ?: return AuthResult.Failure(AuthFailureReason.STATE_MISMATCH, "missing-response-state")
        if (expected != actual) {
            return AuthResult.Failure(AuthFailureReason.STATE_MISMATCH, "state")
        }

        val expectedRedirect = OidcConfiguration.normalizeRedirectUri(expectedRedirectUri)
        val actualRedirect = OidcConfiguration.normalizeRedirectUri(responseRedirectUri)
        if (expectedRedirect == null || actualRedirect == null || expectedRedirect != actualRedirect) {
            return AuthResult.Failure(AuthFailureReason.REDIRECT_MISMATCH, "redirect-uri")
        }

        val providerError = error?.trim()?.takeIf { it.isNotEmpty() }
        if (providerError != null) {
            return if (isCancelledProviderError(providerError)) {
                AuthResult.Failure(AuthFailureReason.CANCELLED, "provider-cancelled")
            } else {
                AuthResult.Failure(AuthFailureReason.PROVIDER_ERROR, "provider-error")
            }
        }

        if (code.isNullOrBlank()) {
            return AuthResult.Failure(AuthFailureReason.MISSING_CODE, "empty-code")
        }

        return null
    }
}
