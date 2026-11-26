package com.wotbtools.app

import android.content.Intent
import android.util.Log
import com.wotbtools.app.MainActivity.Companion.AUTH_CHANGED_GLOBAL
import com.wotbtools.app.MainActivity.Companion.CONNECTIVITY_CHANGED_GLOBAL
import com.wotbtools.app.MainActivity.Companion.TAG
import com.wotbtools.app.auth.AuthFailureReason
import com.wotbtools.app.auth.AuthManager
import com.wotbtools.app.auth.AuthResult
import org.json.JSONObject


internal fun MainActivity.handleAuthorizationIntent(intent: Intent?): Boolean {
    if (!AuthManager.isAuthorizationIntent(intent)) return false
    handleAuthorizationResult(intent)
    return true
}

internal fun MainActivity.handleAuthorizationResult(intent: Intent?) {
    val result = try {
        authManager.handleAuthorizationResult(intent)
    } catch (e: Exception) {
        Log.d(TAG, "auth-result crashed category=${e.javaClass.simpleName}")
        null
    }
    if (result !is AuthResult.Failure) return
    if (result.detail == AuthManager.ALREADY_PROCESSED_DETAIL) return
    if (result.detail == AuthManager.NO_PENDING_TRANSACTION_DETAIL) return
    if (result.reason == AuthFailureReason.CANCELLED) return
    toast(getString(R.string.auth_login_failed_retry))
}

internal fun MainActivity.notifyAuthChanged() {
    runOnUiThread {
        if (destroyedRuntime || runtime.currentUrl.isNullOrEmpty()) return@runOnUiThread
        runtime.postEvent(AUTH_CHANGED_GLOBAL)
    }
}

internal fun MainActivity.notifyConnectivityChanged() {
    if (!destroyedRuntime) checkForUpdateAsync()
    runOnUiThread {
        if (destroyedRuntime || !runtimeReady || runtime.currentUrl.isNullOrEmpty()) return@runOnUiThread
        runtime.postEvent(CONNECTIVITY_CHANGED_GLOBAL)
    }
}


internal fun MainActivity.authGetState(): org.json.JSONObject {
    val session = authManager.currentSession()
    return org.json.JSONObject()
        .put("authenticated", session.authenticated)
        .put("expiresAt", session.expiresAtSeconds ?: org.json.JSONObject.NULL)
}

internal fun MainActivity.authLogin(uiLocale: String?): Boolean = authManager.login(uiLocale)

internal fun MainActivity.authLogout(): Boolean = authManager.logout()

internal fun MainActivity.authGetAccessToken(minValiditySeconds: Long): org.json.JSONObject {
    if (connectivityMonitor.state != "online") {
        val cached = authManager.currentSession()
        return if (cached.isValidFor(minValiditySeconds, System.currentTimeMillis())) sessionJson(cached)
        else tokenFailureJson(if (cached.authenticated) "refresh-failed" else "unauthenticated")
    }
    return when (val result = authManager.accessTokenOrRefresh(minValiditySeconds)) {
        is AuthResult.Success -> sessionJson(result.session)
        is AuthResult.Failure -> tokenFailureJson(result.wireError)
        else -> tokenFailureJson("unauthenticated")
    }
}

internal fun MainActivity.tokenFailureJson(error: String): org.json.JSONObject {
    val cached = if (error == "refresh-failed") authManager.currentSession().takeIf { it.authenticated } else null
    return org.json.JSONObject()
        .put("token", org.json.JSONObject.NULL)
        .put("expiresAt", cached?.expiresAtSeconds ?: org.json.JSONObject.NULL)
        .put("claims", claimsJson(cached?.claims))
        .put("error", error)
}

internal fun MainActivity.sessionJson(session: com.wotbtools.app.auth.AuthSession): org.json.JSONObject =
    org.json.JSONObject()
        .put("token", session.accessToken ?: org.json.JSONObject.NULL)
        .put("expiresAt", session.expiresAtSeconds ?: org.json.JSONObject.NULL)
        .put("claims", claimsJson(session.claims))
        .put("error", org.json.JSONObject.NULL)

internal fun MainActivity.claimsJson(claims: Map<String, Any?>?): Any {
    if (claims == null) return org.json.JSONObject.NULL
    val json = org.json.JSONObject()
    claims.forEach { (key, value) -> json.put(key, value ?: org.json.JSONObject.NULL) }
    return json
}
