package com.wotbtools.app.auth

internal enum class AuthFailureReason {
    STATE_MISMATCH,

    REDIRECT_MISMATCH,

    MISSING_CODE,

    CANCELLED,

    PROVIDER_ERROR,

    EXCHANGE_FAILED,

    UNAUTHENTICATED,

    REFRESH_FAILED,

    CORRUPTED_STATE,

    UNSUPPORTED
}

internal sealed class AuthResult {

    internal data class Success(val session: AuthSession) : AuthResult()

    internal object ExchangeStarted : AuthResult()

    internal data class Failure(
        val reason: AuthFailureReason,
        val detail: String? = null
    ) : AuthResult() {
        val logToken: String = reason.name.lowercase()

        val wireError: String =
            if (reason == AuthFailureReason.REFRESH_FAILED) "refresh-failed" else "unauthenticated"
    }
}
