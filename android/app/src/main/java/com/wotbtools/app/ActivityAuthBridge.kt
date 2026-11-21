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

// ── Native 认证（owner 是 auth/AuthManager；这里只做接线与投影）──

/**
 * 授权回程 intent 判定：AppAuth 的回程 intent 一定带 [net.openid.appauth.AuthorizationResponse]
 * 或 [net.openid.appauth.AuthorizationException] extra。两者都没有就不是 auth 回程，交给 replay ingress。
 *
 * 注意：回程经 PendingIntent 投递，因此冷启动落在 `onCreate`、热启动落在 `onNewIntent`；
 * `onActivityResult` 只是防御性兜底（同一份处理逻辑，不重复实现）。
 */
internal fun MainActivity.handleAuthorizationIntent(intent: Intent?): Boolean {
    // 判定归 AuthManager（单一实现）：三类生命周期入口共用同一条「是不是 auth 回程」规则。
    if (!AuthManager.isAuthorizationIntent(intent)) return false
    handleAuthorizationResult(intent)
    return true
}

/**
 * 处理一次授权响应：结果归 [AuthManager]，这里只做 UI 反馈。
 *
 * 会话真正建立是异步的（token endpoint 往返），所以这里只处理**失败**的即时反馈：弹出「登录失败，
 * 请重试」；成功路径由 `wotbtoolsOnAuthChanged` 通知页面，绝不在这里抢先 loadUrl。
 * 取消与失败都必须回到「可复用的未认证」——不 reload、不导航、不停留在空白页。
 */
internal fun MainActivity.handleAuthorizationResult(intent: Intent?) {
    val result = try {
        authManager.handleAuthorizationResult(intent)
    } catch (e: Exception) {
        Log.d(TAG, "auth-result crashed category=${e.javaClass.simpleName}")
        null
    }
    if (result !is AuthResult.Failure) return
    // 三种失败不需要用户干预：
    //  - cancelled：用户主动放弃，页面保持未认证即可；
    //  - already-processed：系统把同一个回程 intent 又交付了一次，不是一次新的登录失败；
    //  - no-pending-transaction：回程没有对应的进行中交易（伪造的，或这笔交易已被消费），
    //    用户并没有发起一次新的登录。
    if (result.detail == AuthManager.ALREADY_PROCESSED_DETAIL) return
    if (result.detail == AuthManager.NO_PENDING_TRANSACTION_DETAIL) return
    if (result.reason == AuthFailureReason.CANCELLED) return
    toast(getString(R.string.auth_login_failed_retry))
}

/**
 * Native 认证变更 → 通知页面（全局 `wotbtoolsOnAuthChanged`），并顺带同步一次页面可见的会话状态。
 * 只在页面真的加载过时发送；没有页面就没有可通知的消费者。
 */
internal fun MainActivity.notifyAuthChanged() {
    // 这个 listener 可能由后台线程触发（bridge 的认证线程 / 库回调）：引擎只能在主线程使用，
    // 所以连「有没有页面」这个判断也放进主线程，绝不在调用线程碰引擎。
    runOnUiThread {
        if (destroyedRuntime || runtime.currentUrl.isNullOrEmpty()) return@runOnUiThread
        // 全局名来自 wire 契约（events.authChanged.global），页面据此重新拉 authGetState / authGetAccessToken。
        runtime.postEvent(AUTH_CHANGED_GLOBAL)
    }
}

/**
 * 连通性变化 → 通知页面（全局 `wotbtoolsOnConnectivityChanged`）。
 *
 * 推送**不携带 payload**：页面收到通知后回读 `connectivityGetState`，因此不存在
 * 「事件说在线、读回来是离线」的双事实源（与 authChanged 同一约定）。回调可能在主线程之外
 * （binder 线程经 mainHandler 转发，这里仍保守地按 post 处理）。
 */
internal fun MainActivity.notifyConnectivityChanged() {
    if (!destroyedRuntime) checkForUpdateAsync()
    runOnUiThread {
        if (destroyedRuntime || !runtimeReady || runtime.currentUrl.isNullOrEmpty()) return@runOnUiThread
        runtime.postEvent(CONNECTIVITY_CHANGED_GLOBAL)
    }
}

// ── 认证 bridge 投影（在后台线程调用，结果经 reply 回调）──

/** `authGetState`：会话快照，绝不触发网络。 */
internal fun MainActivity.authGetState(): org.json.JSONObject {
    val session = authManager.currentSession()
    return org.json.JSONObject()
        .put("authenticated", session.authenticated)
        .put("expiresAt", session.expiresAtSeconds ?: org.json.JSONObject.NULL)
}

/**
 * `authLogin`：先补齐 discovery，再启动 external user-agent（Custom Tabs），
 * 并持久化含 PKCE verifier 的交易状态。返回 true 只在真的把它交给了浏览器时。
 */
internal fun MainActivity.authLogin(uiLocale: String?): Boolean = authManager.login(uiLocale)

/** `authLogout`：先清本地会话（内存 + 加密存储），再 best-effort 结束 Keycloak SSO 会话。 */
internal fun MainActivity.authLogout(): Boolean = authManager.logout()

/**
 * `authGetAccessToken`：满足 minValiditySeconds 直接返回；否则单飞 refresh。
 *
 * `claims` 是 access token 解码后的 JWT payload（roles / preferred_username），供前端与
 * keycloak-js `tokenParsed` 对齐；refresh token / 授权码 / verifier 永不出现。
 */
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

/** Cached claims on transient failure are a local UI projection, never API authorization. */
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

/** claims 只做 JSON 投影；Map 里的 null 值保留为 JSON null，不改写、不过滤。 */
internal fun MainActivity.claimsJson(claims: Map<String, Any?>?): Any {
    if (claims == null) return org.json.JSONObject.NULL
    val json = org.json.JSONObject()
    claims.forEach { (key, value) -> json.put(key, value ?: org.json.JSONObject.NULL) }
    return json
}
