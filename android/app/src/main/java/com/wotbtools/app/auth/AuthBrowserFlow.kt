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
    /** discovery 结果：进程内缓存一次（Keycloak metadata 不随请求变化）。 */
    private var configuration: AuthorizationServiceConfiguration? = null

    /** discovery 是否在飞（防止并发重复拉取）。 */
    private var discovering = false

    /** discovery 完成后待执行的一次登录（用户在 metadata 到手前就点了登录）。 */
    private var pendingLogin = false

    /** 排队登录要用的登录页语言（OIDC `ui_locales`）；与 [pendingLogin] 同锁读写。 */
    private var pendingUiLocale: String? = null

    // ── 登录 ──

    /**
     * 预热 discovery：拉取一次 Keycloak metadata 并缓存（进程内一次）。
     *
     * 失败只记日志：认证不是启动门禁，没有配置时 [login] 只会回 false，页面按既有失败路径提示重试。
     */
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
            // 没有 metadata 就排队，并在需要时发起一次 discovery。
            pendingLogin = true
            pendingUiLocale = uiLocale
            if (!discovering) {
                discovering = true
                fetchNeeded = true
            }
            false
        }
        if (ready) {
            // 返回值语义：true = 已受理（交易已落盘并已交给浏览器）；false = 无法受理（落盘失败）。
            return launchAuthorization(uiLocale)
        }
        if (fetchNeeded) onMainThread { fetchConfiguration() }
        Log.d(TAG, "auth-login queued reason=configuration-pending")
        return true
    }

    /** 把 `startActivity` 类动作切到主线程；已经在主线程时直接执行。 */
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
                        // 排队中的登录无法完成：必须让页面知道（重新取状态 → 自行提示重试），
                        // 否则用户点的那一次登录会静默消失。
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
                    // 只补上排队的那一次登录：没有排队就不主动弹浏览器（预热不等于自动登录）。
                    if (queued) launchAuthorization(queuedUiLocale)
                }
            }
        )
    }

    /**
     * 真正启动 external user-agent。必须在主线程调用（库内部走 `startActivity`）。
     *
     * PKCE 必须**显式 S256**：单参数 `setCodeVerifier(verifier)` 不会设置
     * `codeVerifierChallengeMethod`，授权 URL 会带上没有 method 的 `code_challenge`，Keycloak 按
     * `plain` 处理 —— 那是一次真实的 PKCE 降级。这里三个参数全部显式给出。
     *
     * state 与 nonce 由库的 builder 自动生成（`AuthorizationRequest.Builder` 构造时生成随机 state，
     * `build()` 时生成 nonce），无需也不应手工设置：手工设置会引入第二个随机源。
     */
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

        // 交易必须先**成功落盘**才允许启动浏览器：没有落盘的交易不可能通过回程的归属校验，
        // 启动它等于制造一次必然失败的登录（见 persistTransactionThenLaunch）。
        //
        // 线程：调用方通常是 bridge 的认证线程（落了盘就能立刻给出诚实的返回值）；若调用方是主线程
        // （discovery 回调补齐排队登录），落盘 + 启动整体交给 auth executor，主线程不做磁盘 /
        // Keystore I/O。
        return if (Looper.myLooper() === Looper.getMainLooper()) {
            executor.execute { persistTransactionThenLaunch(request, selectedRedirectUri) }
            true
        } else {
            persistTransactionThenLaunch(request, selectedRedirectUri)
        }
    }

    /**
     * 落盘交易 → 启动 external user-agent。顺序不可颠倒：落盘失败时**绝不**打开浏览器，
     * 也绝不留下「已受理」的假象（调用方拿到 false，页面据此把这次登录当成可重试的失败）。
     */
    private fun persistTransactionThenLaunch(request: AuthorizationRequest, redirectUri: String): Boolean {
        // 没有 state 的请求无法做交易归属校验：绝不启动（fail closed），也绝不留下一笔无法匹配的交易。
        val state = request.state?.takeIf { it.isNotBlank() }
        if (state == null) {
            Log.d(TAG, "auth-login not-launched reason=missing-state")
            notifyListeners()
            return false
        }
        if (!transactions.save(state, redirectUri)) {
            // 落盘失败（Keystore / prefs 异常）：不启动、不假装已受理；已有会话原样保留。
            Log.d(TAG, "auth-login not-launched reason=persist-failed")
            // 让页面重新取一次状态：用户那次点击不会静默消失，登录按钮仍然可重试。
            notifyListeners()
            return false
        }
        Log.d(TAG, "auth-login persisted redirect=${OidcConfiguration.redirectCategory(redirectUri)}")
        onMainThread { startAuthorizationRequest(request, state) }
        return true
    }

    /**
     * AppAuth 回程 `PendingIntent` 的 flag 策略（**只**用于 AppAuth 的回程，不要外推到其它
     * PendingIntent）。
     *
     * AppAuth 的 `AuthorizationManagementActivity` 并不复用调用方给的 Intent：它先组装一个新的
     * 响应 Intent（`AuthorizationResponse.EXTRA_RESPONSE` / `AuthorizationException.EXTRA_EXCEPTION`
     * 两个 extra + 完整 redirect URI 作为 data），再用
     * `callback.send(context, 0, responseData)` 交给调用方的 completion `PendingIntent`。
     * 因此这个 PendingIntent **必须允许 AppAuth 填入自己的 Intent**：
     *
     *  - `FLAG_IMMUTABLE` 冻结创建时的 Intent，`send(..., fillInIntent)` 的填充会被静默忽略 ⇒
     *    `MainActivity.isAuthorizationIntent()` 看不到 response/exception extra，回程被当成一次普通
     *    启动，授权码永远不会被交换（真机表现：浏览器里认证成功，App 里始终未登录）。
     *  - `FLAG_MUTABLE` 自 API 31 起存在；minSdk 26 必须按版本降级 —— 31 以下不存在「不可变」默认，
     *    `FLAG_UPDATE_CURRENT` 本身就允许填充。
     *
     * 基础 Intent 仍然必须是**显式组件**（`Intent(appContext, activityClass())`）：可变的是
     * 「允许 AppAuth 填 extras」，而不是「允许任意应用隐式解析到这个 PendingIntent」。
     */
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
            // 浏览器不可用 / 启动失败：这笔交易不可能再有回程，按身份清掉它（若中间已被新交易替换，
            // clearIfState 会保留新的那笔）。
            transactions.clearIfState(transactionState, "launch-failed")
            Log.d(TAG, "auth-login failed category=${e.javaClass.simpleName}")
        }
    }

    /** best-effort 远端 end-session：失败只记日志，本地会话早已清空。 */
    fun endSession(idTokenHint: String?) {
        val config = synchronized(lock) { configuration }
        if (config?.endSessionEndpoint == null) {
            Log.d(TAG, "auth-end-session skipped reason=no-end-session-endpoint")
            return
        }
        try {
            val builder = EndSessionRequest.Builder(config)
                .setPostLogoutRedirectUri(Uri.parse(OidcConfiguration.PRIVATE_REDIRECT_URI))
            // id_token 只在存在时作为 hint：没有会话时仍然结束 SSO 会话。
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
