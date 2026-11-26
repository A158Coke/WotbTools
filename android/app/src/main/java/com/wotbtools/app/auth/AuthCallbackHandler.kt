package com.wotbtools.app.auth

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.util.Log
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationResponse

internal class AuthCallbackHandler(
    private val transactions: AuthTransactionStore,
    private val exchangeAuthorizationCode: (AuthorizationResponse, String) -> Unit,
) {
    @Volatile
    private var processedResponseState: String? = null

    private fun alreadyProcessed(intent: Intent?): Boolean {
        val seen = processedResponseState ?: return false
        val response = try {
            intent?.let { AuthorizationResponse.fromIntent(it) }
        } catch (_: Exception) {
            null
        }
        val state = response?.request?.state ?: return false
        return state == seen
    }


    internal fun handleAuthorizationResult(intent: Intent?): AuthResult {
        if (AuthManager.isAuthorizationIntent(intent) && alreadyProcessed(intent)) {
            Log.d(TAG, "auth-result ignored reason=already-processed")
            return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, AuthManager.ALREADY_PROCESSED_DETAIL)
        }

        val exception = try {
            intent?.let { AuthorizationException.fromIntent(it) }
        } catch (_: Exception) {
            null
        }
        if (exception != null) {
            val reason = when {
                exception.code == AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW.code ->
                    AuthFailureReason.CANCELLED
                exception.code == AuthorizationException.GeneralErrors.PROGRAM_CANCELED_AUTH_FLOW.code ->
                    AuthFailureReason.CANCELLED
                AuthResponseGuard.isCancelledProviderError(exception.error) -> AuthFailureReason.CANCELLED
                exception.code == AuthorizationException.AuthorizationRequestErrors.STATE_MISMATCH.code ->
                    AuthFailureReason.STATE_MISMATCH
                else -> AuthFailureReason.PROVIDER_ERROR
            }
            val returnedState = stateOf(intent?.data)
            val consumed = transactions.clearIfState(returnedState, "auth-exception")
            val detail = exception.error?.takeIf { it.isNotBlank() }
            Log.d(TAG, "auth-result outcome=failure reason=${reason.name.lowercase()} " +
                "code=${exception.code} error=${detail ?: "none"} " +
                "transaction=${if (consumed) "consumed" else "preserved"}")
            return AuthResult.Failure(reason, detail)
        }

        val response = try {
            intent?.let { AuthorizationResponse.fromIntent(it) }
        } catch (_: Exception) {
            null
        }
        if (response == null) {
            Log.d(TAG, "auth-result outcome=cancelled reason=no-response transaction=preserved")
            return AuthResult.Failure(AuthFailureReason.CANCELLED, "no-response")
        }

        val transaction = transactions.load()
        if (transaction == null) {
            Log.d(TAG, "auth-result outcome=rejected reason=no-pending-transaction")
            return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, AuthManager.NO_PENDING_TRANSACTION_DETAIL)
        }

        val guardFailure = AuthResponseGuard.verify(
            expectedState = transaction.state,
            responseState = response.state,
            expectedRedirectUri = transaction.redirectUri,
            responseRedirectUri = redirectUriOf(intent?.data),
            code = response.authorizationCode,
            error = response.additionalParameters[ERROR_PARAM]
        )
        if (guardFailure != null) {
            val consumed = transactions.clearIfState(response.state, "guard-${guardFailure.logToken}")
            Log.d(TAG, "auth-result outcome=rejected reason=${guardFailure.logToken} " +
                "detail=${guardFailure.detail} transaction=${if (consumed) "consumed" else "preserved"}")
            return guardFailure
        }

        exchangeAuthorizationCode(response, transaction.state)
        processedResponseState = response.request.state
        Log.d(TAG, "auth-result outcome=exchanging")
        return AuthResult.ExchangeStarted
    }


    private fun redirectUriOf(responseUri: Uri?): String? {
        val uri = responseUri ?: return null
        val scheme = uri.scheme ?: return null
        val builder = Uri.Builder().scheme(scheme)
        uri.encodedAuthority?.let { builder.encodedAuthority(it) }
        uri.encodedPath?.let { builder.encodedPath(it) }
        return try {
            builder.build().toString()
        } catch (_: Exception) {
            null
        }
    }

    private fun stateOf(responseUri: Uri?): String? = try {
        responseUri?.getQueryParameter(STATE_PARAM)?.takeIf { it.isNotBlank() }
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val TAG = "WotbAuth"
        const val STATE_PARAM = "state"
        const val ERROR_PARAM = "error"
    }
}
