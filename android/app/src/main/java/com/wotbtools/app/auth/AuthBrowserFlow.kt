package com.wotbtools.app.auth

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.CodeVerifierUtil
import net.openid.appauth.EndSessionRequest
import net.openid.appauth.ResponseTypeValues
import java.util.concurrent.ExecutorService

internal class AuthBrowserFlow(
    private val appContext: Context,
    private val transactions: AuthTransactionStore,
    private val lock: Any,
    private val executor: ExecutorService,
    private val mainHandler: Handler,
    private val activityClass: () -> Class<*>,
    private val authorizationService: () -> AuthorizationService,
    private val notifyListeners: () -> Unit,
) {
    private var configuration: AuthorizationServiceConfiguration? = null

    private var discovering = false

    private var pendingLogin = false

    private var pendingUiLocale: String? = null


    internal fun warmUp() {
        var needsFetch = false
        synchronized(lock) {
            if (configuration == null && !discovering) {
                discovering = true
                needsFetch = true
            }
        }
        if (needsFetch) onMainThread { fetchConfiguration() }
    }

    /**
     * 启动登录：构建 Authorization Code + PKCE(S256) 请求，持久化含 verifier 的交易状态，
     * 然后把它交给 external user-agent（Custom Tabs）。
     *
     * 线程：由 bridge 的**后台**线程调用；真正的启动被切到主线程（AppAuth 内部走 `startActivity`）。
     * 不在这里等待启动结果 —— 那会把后台线程绑在主线程队列上（主线程若正忙就可能长时间阻塞），
     * 返回值的语义是「请求已被受理」而不是「浏览器窗口已经出现」。
     *
     * metadata 还没到手时**排队**而不是拒绝：冷启动后用户可能比 discovery 更快点登录，
     * 直接回 false 会白丢一次点击。拉取失败时走 [notifyListeners]，让页面重新取状态后自行决定重试，
     * 绝不静默吞掉一次点击。
     *
     * [uiLocale] 是页面当前语言（bridge 已按白名单收窄），作为 OIDC `ui_locales` 让登录页默认同语言；null 不带。
     *
     * @return true 表示这次请求已被受理（立刻启动或排队等待 metadata）；false 表示完全无法受理。
     */
    internal fun login(uiLocale: String? = null): Boolean {
        var fetchNeeded = false
        val ready = synchronized(lock) {
            if (configuration != null) return@synchronized true
            pendingLogin = true
            pendingUiLocale = uiLocale
            if (!discovering) {
                discovering = true
                fetchNeeded = true
            }
            false
        }
        if (ready) {
            return launchAuthorization(uiLocale)
        }
        if (fetchNeeded) onMainThread { fetchConfiguration() }
        Log.d(TAG, "auth-login queued reason=configuration-pending")
        return true
    }

    fun onMainThread(action: () -> Unit) {
        if (Looper.myLooper() === Looper.getMainLooper()) action() else mainHandler.post(action)
    }

    private fun fetchConfiguration() {
        val issuer = Uri.parse(OidcConfiguration.ISSUER)
        AuthorizationServiceConfiguration.fetchFromIssuer(
            issuer,
            object : AuthorizationServiceConfiguration.RetrieveConfigurationCallback {
                override fun onFetchConfigurationCompleted(
                    fetched: AuthorizationServiceConfiguration?,
                    ex: AuthorizationException?
                ) {
                    if (fetched == null) {
                        Log.d(TAG, "auth-discovery failed category=${ex?.error ?: "unknown"}")
                        val dropped = synchronized(lock) {
                            discovering = false
                            val wasPending = pendingLogin
                            pendingLogin = false
                            pendingUiLocale = null
                            wasPending
                        }
                        if (dropped) notifyListeners()
                        return
                    }
                    var queuedUiLocale: String? = null
                    val queued = synchronized(lock) {
                        configuration = fetched
                        discovering = false
                        val wasPending = pendingLogin
                        pendingLogin = false
                        queuedUiLocale = pendingUiLocale
                        pendingUiLocale = null
                        wasPending
                    }
                    Log.d(TAG, "auth-discovery ready")
                    if (queued) launchAuthorization(queuedUiLocale)
                }
            }
        )
    }

    private fun launchAuthorization(uiLocale: String?): Boolean {
        val config = synchronized(lock) { configuration }
        if (config == null) {
            Log.d(TAG, "auth-login not-launched reason=no-configuration")
            return false
        }

        val selectedRedirectUri = OidcRedirectStrategy.redirectUri()
        val builder = AuthorizationRequest.Builder(
            config,
            OidcConfiguration.CLIENT_ID,
            ResponseTypeValues.CODE,
            Uri.parse(selectedRedirectUri)
        ).setScope(OidcConfiguration.SCOPE)
        if (uiLocale != null) builder.setUiLocales(uiLocale)
        val verifier = CodeVerifierUtil.generateRandomCodeVerifier()
        builder.setCodeVerifier(
            verifier,
            CodeVerifierUtil.deriveCodeVerifierChallenge(verifier),
            AuthorizationRequest.CODE_CHALLENGE_METHOD_S256
        )
        val request = builder.build()

        return if (Looper.myLooper() === Looper.getMainLooper()) {
            executor.execute { persistTransactionThenLaunch(request, selectedRedirectUri) }
            true
        } else {
            persistTransactionThenLaunch(request, selectedRedirectUri)
        }
    }

    private fun persistTransactionThenLaunch(request: AuthorizationRequest, redirectUri: String): Boolean {
        val state = request.state?.takeIf { it.isNotBlank() }
        if (state == null) {
            Log.d(TAG, "auth-login not-launched reason=missing-state")
            notifyListeners()
            return false
        }
        if (!transactions.save(state, redirectUri)) {
            Log.d(TAG, "auth-login not-launched reason=persist-failed")
            notifyListeners()
            return false
        }
        Log.d(TAG, "auth-login persisted redirect=${OidcConfiguration.redirectCategory(redirectUri)}")
        onMainThread { startAuthorizationRequest(request, state) }
        return true
    }

    private fun appAuthCallbackFlags(): Int =
        PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0

    /**
     * 把请求交给 external user-agent。主线程调用：库内部走 `startActivity`。
     *
     * @param transactionState 这笔交易的 `state`：启动失败时用它做身份匹配的清理，绝不误清
     *   一笔在这中间被替换掉的新交易。
     */
    private fun startAuthorizationRequest(request: AuthorizationRequest, transactionState: String) {
        val completionIntent = PendingIntent.getActivity(
            appContext,
            REQUEST_CODE_LOGIN,
            Intent(appContext, activityClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            appAuthCallbackFlags()
        )
        try {
            authorizationService().performAuthorizationRequest(request, completionIntent)
            Log.d(TAG, "auth-login launched")
        } catch (e: Exception) {
            transactions.clearIfState(transactionState, "launch-failed")
            Log.d(TAG, "auth-login failed category=${e.javaClass.simpleName}")
        }
    }

    fun endSession(idTokenHint: String?) {
        val config = synchronized(lock) { configuration }
        if (config?.endSessionEndpoint == null) {
            Log.d(TAG, "auth-end-session skipped reason=no-end-session-endpoint")
            return
        }
        try {
            val builder = EndSessionRequest.Builder(config)
                .setPostLogoutRedirectUri(Uri.parse(OidcConfiguration.PRIVATE_REDIRECT_URI))
            if (!idTokenHint.isNullOrBlank()) builder.setIdTokenHint(idTokenHint)
            val completionIntent = PendingIntent.getActivity(
                appContext,
                REQUEST_CODE_END_SESSION,
                Intent(appContext, activityClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                appAuthCallbackFlags()
            )
            authorizationService().performEndSessionRequest(builder.build(), completionIntent)
            Log.d(TAG, "auth-end-session launched")
        } catch (e: Exception) {
            Log.d(TAG, "auth-end-session skipped category=${e.javaClass.simpleName}")
        }
    }

    private companion object {
        const val TAG = "WotbAuth"
        const val REQUEST_CODE_LOGIN = 0
        const val REQUEST_CODE_END_SESSION = 1
    }
}
