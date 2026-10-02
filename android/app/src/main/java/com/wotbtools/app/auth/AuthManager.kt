package com.wotbtools.app.auth

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Native 认证的编排 owner（process 级单例，持有 `applicationContext`）。
 *
 * ── ownership 边界 ──
 *  - WebView **不再拥有认证**：App 内不再出现任何 IdP / provider host，登录只在 external
 *    user-agent（Custom Tabs，AppAuth 选择）里发生；回程经 [OidcRedirectStrategy] 选定的
 *    redirect URI 落到 `net.openid.appauth.RedirectUriReceiverActivity`。
 *  - 本类只向 bridge 暴露 [AuthSession]（access token + claims + 到期秒）与显式失败原因；
 *    refresh token / 授权码 / PKCE verifier / state / nonce 永不出本类（只以密文落盘）。
 *  - 网络与 token 操作都不在 WebView 线程：发现走库的 AsyncTask，持久化与等待走 [executor]，
 *    bridge 的 WebView 线程只提交请求、异步收结果。
 *
 * ── 线程模型（刻意写死，避免回调线程猜谜）──
 *  - [login] / [logout] / [accessTokenOrRefresh]：**任意线程**（bridge 的后台线程）调用；
 *    需要 `startActivity` 的动作内部切到主线程（见 [onMainThread]）。
 *  - [handleAuthorizationResult]：**主线程**调用（从 Activity 生命周期回调进入）。
 *  - 单飞 refresh 用一个 `refreshInFlight` 标志 + waiter latch 列表表达：并发调用者里只有第一个
 *    触发 `AuthState.performActionWithFreshTokens`，其余等同一份结果，绝不发出第二次 refresh。
 *
 * ── 日志纪律 ──
 *  只记分类 token（`auth-login launched`、`auth-result outcome=...`、`auth-refresh outcome=...`）。
 *  token / code / verifier / state / nonce / claims / 完整 URI 一律不落日志。
 */
internal class AuthManager private constructor(context: Context) {

    /** 会话变更通知（login 成功 / logout / refresh 失败清会话）。回调线程 = 触发方线程。 */
    internal fun interface Listener {
        fun onAuthChanged()
    }

    private val appContext = context.applicationContext
    private val store = AuthStateStore(appContext)
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "wotb-auth")
    }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val lock = Any()

    /**
     * 共享的 AppAuth 服务实例：懒建、进程内复用（Custom Tabs 连接复用有意义）。
     *
     * 刻意**不**在 `onDestroy` 里 dispose：本对象是 process 级单例，一次登录交易要跨 Activity 重建
     * （旋转屏 / 被系统回收后回来）存活，dispose 后下一次 launch 会抛 `IllegalStateException`。
     * 服务只持有 `applicationContext`，随进程回收，不存在 Activity 泄漏。
     */
    private var authService: AuthorizationService? = null

    /** discovery 结果：进程内缓存一次（Keycloak metadata 不随请求变化）。 */
    private var configuration: AuthorizationServiceConfiguration? = null

    /** discovery 是否在飞（防止并发重复拉取）。 */
    private var discovering = false

    /** discovery 完成后待执行的一次登录（用户在 metadata 到手前就点了登录）。 */
    private var pendingLogin = false

    private val listeners = mutableListOf<Listener>()

    private var session: AuthSession? = null

    /** 单飞 refresh：true 表示已有一个 refresh 在飞，后续调用只排队等结果。 */
    private var refreshInFlight = false
    private val refreshWaiters = mutableListOf<CountDownLatch>()

    /**
     * 宿主 `Activity` 类：只用于构造回程 `Intent`，避免 `auth` 包反向依赖 `MainActivity`。
     * 由 [Companion.getInstance] 注入一次，构造后不变。
     */
    private var hostActivityClass: Class<*>? = null

    /**
     * 已经处理过的授权响应 identity（= 该次请求的 `state`）。
     *
     * 为什么必须有：回程经 PendingIntent 投递，而 MainActivity 是 `singleTask`，配置变更 / 进程重建后
     * 系统会把**同一个 intent 再交付一次**。授权码是一次性的，重复交换必然失败，而失败路径会清空会话
     * —— 那会把一次已经成功的登录自己销毁掉。这里只持久化「最近一次处理过的 state」这一个字符串：
     * 不做去重表，也不保存 token / code。
     */
    @Volatile
    private var processedResponseState: String? = null

    // ── 听众注册 ──

    internal fun addListener(listener: Listener) {
        synchronized(lock) { if (!listeners.contains(listener)) listeners.add(listener) }
    }

    internal fun removeListener(listener: Listener) {
        synchronized(lock) { listeners.remove(listener) }
    }

    private fun notifyListeners() {
        val snapshot = synchronized(lock) { listeners.toList() }
        snapshot.forEach { listener ->
            try {
                listener.onAuthChanged()
            } catch (e: Exception) {
                // 通知失败绝不能影响认证结果本身。
                Log.d(TAG, "auth-notify-failed category=${e.javaClass.simpleName}")
            }
        }
    }

    // ── 会话读取 ──

    /** 当前会话快照：内存命中优先，否则从加密存储恢复（损坏 → 未认证，绝不崩溃）。 */
    internal fun currentSession(): AuthSession = synchronized(lock) { session }
        ?: restoreFromStore()
        ?: AuthSession.unauthenticated()

    /** 内存未命中时从加密存储恢复；失败即未认证（条目已在 store 内清空）。 */
    private fun restoreFromStore(): AuthSession? {
        val entry = store.load() ?: return null
        // 显式标注类型：catch 分支非局部 return，try 表达式因此是 AuthSession（非 null）。
        val restored: AuthSession = try {
            val authState = net.openid.appauth.AuthState.jsonDeserialize(entry.authStateJson)
            sessionOf(authState)
        } catch (_: Exception) {
            // 解密成功但 JSON 形状不对：同样当作损坏，清掉重来。
            store.clear("deserialize-failed")
            return null
        }
        // 只有真的解析出 access token 才缓存；空状态不占内存，下次仍会重读存储。
        if (restored.authenticated) synchronized(lock) { session = restored }
        return restored
    }

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
     * @return true 表示这次请求已被受理（立刻启动或排队等待 metadata）；false 表示完全无法受理。
     */
    internal fun login(): Boolean {
        var fetchNeeded = false
        val ready = synchronized(lock) {
            if (configuration != null) return@synchronized true
            // 没有 metadata 就排队，并在需要时发起一次 discovery。
            pendingLogin = true
            if (!discovering) {
                discovering = true
                fetchNeeded = true
            }
            false
        }
        if (ready) {
            // 不需要先切主线程：launchAuthorization 自己完成「落盘（executor）→ 启动（主线程）」。
            launchAuthorization()
            return true
        }
        if (fetchNeeded) onMainThread { fetchConfiguration() }
        Log.d(TAG, "auth-login queued reason=configuration-pending")
        return true
    }

    /** 把 `startActivity` 类动作切到主线程；已经在主线程时直接执行。 */
    private fun onMainThread(action: () -> Unit) {
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
                            wasPending
                        }
                        // 排队中的登录无法完成：必须让页面知道（重新取状态 → 自行提示重试），
                        // 否则用户点的那一次登录会静默消失。
                        if (dropped) notifyListeners()
                        return
                    }
                    val queued = synchronized(lock) {
                        configuration = fetched
                        discovering = false
                        val wasPending = pendingLogin
                        pendingLogin = false
                        wasPending
                    }
                    Log.d(TAG, "auth-discovery ready")
                    // 只补上排队的那一次登录：没有排队就不主动弹浏览器（预热不等于自动登录）。
                    if (queued) launchAuthorization()
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
    private fun launchAuthorization(): Boolean {
        val config = synchronized(lock) { configuration }
        if (config == null) {
            Log.d(TAG, "auth-login not-launched reason=no-configuration")
            return false
        }

        val selectedRedirectUri = OidcRedirectStrategy.redirectUri(appContext)
        val builder = AuthorizationRequest.Builder(
            config,
            OidcConfiguration.CLIENT_ID,
            ResponseTypeValues.CODE,
            Uri.parse(selectedRedirectUri)
        ).setScope(OidcConfiguration.SCOPE)
        val verifier = CodeVerifierUtil.generateRandomCodeVerifier()
        builder.setCodeVerifier(
            verifier,
            CodeVerifierUtil.deriveCodeVerifierChallenge(verifier),
            AuthorizationRequest.CODE_CHALLENGE_METHOD_S256
        )
        val request = builder.build()

        // 交易状态（含 code verifier）必须先落盘再启动：进程死亡 / 被回收后仍要能完成交换。
        // 顺序是 executor 落盘 → 主线程启动，任何线程都不为这次 I/O 阻塞：调用方（bridge 的认证线程）
        // 立刻拿到「已受理」，主线程也不会被磁盘/Keystore 卡住（旧实现的 await 会在主线程等最多 5s）。
        executor.execute {
            store.save(
                AuthStateStore.Entry(
                    request.jsonSerializeString(),
                    selectedRedirectUri,
                    System.currentTimeMillis()
                )
            )
            Log.d(TAG, "auth-login persisted redirect=${OidcConfiguration.redirectCategory(selectedRedirectUri)}")
            onMainThread { startAuthorizationRequest(request) }
        }
        return true
    }

    /** 把请求交给 external user-agent。主线程调用：库内部走 `startActivity`。 */
    private fun startAuthorizationRequest(request: AuthorizationRequest) {
        val completionIntent = PendingIntent.getActivity(
            appContext,
            REQUEST_CODE_LOGIN,
            Intent(appContext, activityClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        try {
            authorizationService().performAuthorizationRequest(request, completionIntent)
            Log.d(TAG, "auth-login launched")
        } catch (e: Exception) {
            // 浏览器不可用 / 启动失败：交易状态不能留下（否则下次响应对不上任何请求）。
            store.clear("launch-failed")
            Log.d(TAG, "auth-login failed category=${e.javaClass.simpleName}")
        }
    }

    /** 回程 `Intent` 的目标 Activity；未注入即抛，属于编程错误（构造必须经 [Companion.getInstance]）。 */
    private fun activityClass(): Class<*> = hostActivityClass
        ?: error("AuthManager.getInstance must be used so the host activity class is known")

    /**
     * 该 intent 是否携带**已经处理过**的那次响应。
     *
     * identity 用请求的 `state`（每次交易随机、唯一）；只有能明确读出同一个 state 时才跳过，
     * 读不出 state 一律当作新响应继续走正常流程 —— 宁可让幂等判断失效，也不能吞掉一次真实登录。
     */
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

    private fun authorizationService(): AuthorizationService {
        synchronized(lock) {
            authService?.let { return it }
            val created = AuthorizationService(appContext)
            authService = created
            return created
        }
    }

    // ── 授权结果 ──

    /**
     * 处理授权结果 intent（MainActivity 的 onCreate / onNewIntent / onActivityResult 都调这里）。
     *
     * 三条路径都必须收敛到「可复用的未认证」或「已认证」，绝不留下卡死状态：
     *  - 空 intent / RESULT_CANCELED / 缺少响应与异常 → [AuthFailureReason.CANCELLED]；
     *  - 响应存在 → 先过 [AuthResponseGuard]（redirect 归属 + code 存在性 + 错误分类），再换 token；
     *  - 交换失败 → 清会话 + [AuthFailureReason.EXCHANGE_FAILED]。
     *
     * 同一个 intent 被系统重复交付时直接跳过（见 [processedResponseState]）：授权码只能用一次。
     */
    internal fun handleAuthorizationResult(intent: Intent?): AuthResult {
        // 同一个回程 intent 重复投递：什么都不做（既不能重复换码，也不能因此清掉已有会话）。
        if (Companion.isAuthorizationIntent(intent) && alreadyProcessed(intent)) {
            Log.d(TAG, "auth-result ignored reason=already-processed")
            return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, ALREADY_PROCESSED_DETAIL)
        }

        // 库已经把 state 不匹配的响应换成 STATE_MISMATCH 异常，走到这里的响应 state 一定匹配。
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
                // IdP 用 error 回程（`?error=access_denied`）时库走的是 exception 路径，响应里根本没有
                // 可读的 error 参数；因此取消家族必须在这里再判一次，否则用户主动取消会被当成故障提示。
                AuthResponseGuard.isCancelledProviderError(exception.error) -> AuthFailureReason.CANCELLED
                exception.code == AuthorizationException.AuthorizationRequestErrors.STATE_MISMATCH.code ->
                    AuthFailureReason.STATE_MISMATCH
                else -> AuthFailureReason.PROVIDER_ERROR
            }
            store.clear("auth-exception")
            val detail = exception.error?.takeIf { it.isNotBlank() }
            Log.d(TAG, "auth-result outcome=failure reason=${reason.name.lowercase()} " +
                "code=${exception.code} error=${detail ?: "none"}")
            return AuthResult.Failure(reason, detail)
        }

        val response = try {
            intent?.let { AuthorizationResponse.fromIntent(it) }
        } catch (_: Exception) {
            null
        }
        if (response == null) {
            store.clear("empty-result")
            Log.d(TAG, "auth-result outcome=cancelled reason=no-response")
            return AuthResult.Failure(AuthFailureReason.CANCELLED, "no-response")
        }

        val guardFailure = AuthResponseGuard.verify(
            expectedState = response.request.state,
            expectedRedirectUri = currentTransactionRedirectUri(),
            responseRedirectUri = redirectUriOf(intent?.data),
            code = response.authorizationCode,
            error = response.additionalParameters[ERROR_PARAM]
        )
        if (guardFailure != null) {
            store.clear("guard-${guardFailure.logToken}")
            Log.d(TAG, "auth-result outcome=rejected reason=${guardFailure.logToken} detail=${guardFailure.detail}")
            return guardFailure
        }

        exchangeAuthorizationCode(response)
        // 记下这次响应的 identity：同一个 intent 再次被交付时直接跳过，避免用已消耗的授权码再换一次。
        processedResponseState = response.request.state
        // 交换是异步的：这里的结果表示「已接受并开始交换」，真正的会话由 authChanged 事件与随后的
        // authGetAccessToken 表达（bridge 不等待 token endpoint）。
        Log.d(TAG, "auth-result outcome=exchanging")
        return AuthResult.ExchangeStarted
    }

    /** 用授权码换 token；成功持久化新 AuthState 并通知，失败清会话（可复用未认证）。 */
    private fun exchangeAuthorizationCode(response: AuthorizationResponse) {
        val service = authorizationService()
        service.performTokenRequest(response.createTokenExchangeRequest()) { tokenResponse, ex ->
            if (tokenResponse == null || ex != null) {
                store.clear("exchange-failed")
                synchronized(lock) { session = null }
                Log.d(TAG, "auth-exchange outcome=failure category=${ex?.error ?: "unknown"}")
                notifyListeners()
                return@performTokenRequest
            }
            // 三参构造：第三个参数是「本次交换的异常」，成功路径必须显式给 null，
            // 否则 Kotlin 会把 null 解析到 (response, exception) 重载上（编译期就报错）。
            val authState = net.openid.appauth.AuthState(
                response,
                tokenResponse,
                null as AuthorizationException?
            )
            // 换 token 可能轮换 refresh token / 更新到期时间：整体覆盖写回。
            val persisted = store.save(
                AuthStateStore.Entry(
                    authState.jsonSerializeString(),
                    currentTransactionRedirectUri() ?: OidcConfiguration.PRIVATE_REDIRECT_URI,
                    System.currentTimeMillis()
                )
            )
            if (!persisted) {
                // 落盘失败不能让用户以为已登录：清会话，保持未认证。
                store.clear("persist-failed")
                synchronized(lock) { session = null }
                Log.d(TAG, "auth-exchange outcome=persist-failed")
                notifyListeners()
                return@performTokenRequest
            }
            synchronized(lock) { session = sessionOf(authState) }
            Log.d(TAG, "auth-exchange outcome=success")
            notifyListeners()
        }
    }

    // ── RP-initiated logout ──

    /**
     * 退出登录。
     *
     * 语义（不改）：
     *  1. **先清本地会话**（内存 + 加密存储）：本地状态绝不能在 logout 之后继续存在，也不依赖网络；
     *  2. 再 best-effort 发起 OIDC RP-initiated logout（id_token_hint + private-scheme 回程），经
     *     external user-agent 打开 Keycloak 的 `end_session_endpoint`；
     *  3. **只结束本 App 在 Keycloak 的会话**：绝不触碰 Chrome / 系统浏览器的 cookie，也绝不把用户从
     *     QQ / Wargaming 登出（那些是 Keycloak 侧的 identity provider 会话，由用户自己在 provider 侧管理）。
     *
     * @return true 恒为真（本地会话已清），不表示远端 end-session 一定完成。
     */
    internal fun logout(): Boolean {
        // 顺序刻意如此：先取 id_token_hint（clearLocalSession 之后密文就没了），再清本地状态，
        // 最后才发远端 end-session —— 「本地状态绝不跨过 logout 存活」不依赖网络，也不依赖主线程。
        val idTokenHint = idTokenHintOf(loadAuthStateForRefresh())
        clearLocalSession()
        onMainThread { endSession(idTokenHint) }
        Log.d(TAG, "auth-logout local-cleared")
        return true
    }

    /** id_token 只作为 end-session 的 hint；不存在就照样结束 SSO 会话。 */
    private fun idTokenHintOf(authState: net.openid.appauth.AuthState?): String? =
        authState?.idToken?.takeIf { it.isNotBlank() }

    /** best-effort 远端 end-session：失败只记日志，本地会话早已清空。 */
    private fun endSession(idTokenHint: String?) {
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
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            authorizationService().performEndSessionRequest(builder.build(), completionIntent)
            Log.d(TAG, "auth-end-session launched")
        } catch (e: Exception) {
            Log.d(TAG, "auth-end-session skipped category=${e.javaClass.simpleName}")
        }
    }

    /** 清本地会话（内存 + 存储）并通知；幂等。 */
    internal fun clearLocalSession() {
        synchronized(lock) { session = null }
        store.clear("logout")
        notifyListeners()
    }

    // ── access token + 单飞 refresh ──

    /**
     * 取 access token：满足 [minValiditySeconds] 直接返回；否则经**单飞** refresh 后返回。
     *
     * 失败语义（与 wire 契约一致）：刷新失败清会话并回 `refresh-failed`；本就没有会话回
     * `unauthenticated`。**必须**在非主线程调用（会阻塞等待 refresh 结果）。
     */
    internal fun accessTokenOrRefresh(minValiditySeconds: Long): AuthResult {
        val now = System.currentTimeMillis()
        val existing = currentSession()
        if (existing.isValidFor(minValiditySeconds, now)) {
            return AuthResult.Success(existing)
        }
        if (!existing.authenticated) {
            // 没有会话可刷新：页面本来就没有 token，语义是 unauthenticated 而不是 refresh-failed。
            return AuthResult.Failure(AuthFailureReason.UNAUTHENTICATED, "no-session")
        }

        val latch = CountDownLatch(1)
        var isOwner = false
        synchronized(lock) {
            refreshWaiters.add(latch)
            if (!refreshInFlight) {
                refreshInFlight = true
                isOwner = true
            }
        }

        if (isOwner) startRefresh() else Log.d(TAG, "auth-refresh joined")

        val completed = try {
            latch.await(REFRESH_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
        if (!completed) {
            synchronized(lock) { refreshWaiters.remove(latch) }
            Log.d(TAG, "auth-refresh outcome=timeout")
            return AuthResult.Failure(AuthFailureReason.REFRESH_FAILED, "timeout")
        }

        val refreshed = synchronized(lock) { session }
        if (refreshed != null && refreshed.isValidFor(minValiditySeconds, System.currentTimeMillis())) {
            return AuthResult.Success(refreshed)
        }
        return AuthResult.Failure(AuthFailureReason.REFRESH_FAILED, "stale-after-refresh")
    }

    /**
     * 触发刷新。`AuthState.performActionWithFreshTokens` 内部已是「先判断再请求」，本类的
     * `refreshInFlight` 只保证**并发调用者共享一次请求**（库的 pending-action 队列不跨调用者聚合）。
     */
    private fun startRefresh() {
        val authState = loadAuthStateForRefresh()
        if (authState == null) {
            // 存储里没有可用状态：没有什么可刷新的，直接按未认证收尾。
            synchronized(lock) { session = null }
            store.clear("no-refresh-state")
            completeRefresh(false)
            return
        }
        authState.performActionWithFreshTokens(
            authorizationService()
        ) { accessToken, _, ex ->
            if (ex != null || accessToken.isNullOrBlank()) {
                // 刷新失败：会话不可再信。清会话，让页面回到未认证并可重新登录。
                store.clear("refresh-failed")
                synchronized(lock) { session = null }
                Log.d(TAG, "auth-refresh outcome=failure category=${ex?.error ?: "empty-token"}")
                completeRefresh(false)
                return@performActionWithFreshTokens
            }
            val refreshed = sessionOf(authState)
            // 刷新后的 AuthState（新 access token / 可能轮换的 refresh token）整体写回。
            val persisted = store.save(
                AuthStateStore.Entry(
                    authState.jsonSerializeString(),
                    currentTransactionRedirectUri() ?: OidcConfiguration.PRIVATE_REDIRECT_URI,
                    System.currentTimeMillis()
                )
            )
            if (!persisted) {
                // 新 token 没能落盘：不能只用内存里的会话（下次启动就没了），按刷新失败收尾。
                store.clear("refresh-persist-failed")
                synchronized(lock) { session = null }
                Log.d(TAG, "auth-refresh outcome=persist-failed")
                completeRefresh(false)
                return@performActionWithFreshTokens
            }
            synchronized(lock) { session = refreshed }
            Log.d(TAG, "auth-refresh outcome=success")
            completeRefresh(true)
        }
    }

    /** 从加密存储恢复 AppAuth `AuthState`（刷新需要它携带的 refresh token）；损坏即 null。 */
    private fun loadAuthStateForRefresh(): net.openid.appauth.AuthState? {
        val entry = store.load() ?: return null
        return try {
            net.openid.appauth.AuthState.jsonDeserialize(entry.authStateJson)
        } catch (_: Exception) {
            store.clear("refresh-deserialize-failed")
            null
        }
    }

    /** 单飞收尾：释放所有 waiter 并结束本次 refresh。 */
    private fun completeRefresh(success: Boolean) {
        val waiters = synchronized(lock) {
            refreshInFlight = false
            val pending = refreshWaiters.toList()
            refreshWaiters.clear()
            pending
        }
        waiters.forEach { it.countDown() }
        // 刷新失败已经清掉会话 → 页面必须知道（这是契约里「refresh 清会话后通知」的路径）。
        if (!success) notifyListeners()
    }

    // ── 交易状态读取 ──

    /** 当前交易使用的回程 URI（响应校验的唯一基准；读不到即由 guard fail closed）。 */
    private fun currentTransactionRedirectUri(): String? = try {
        store.load()?.redirectUri
    } catch (_: Exception) {
        null
    }

    /**
     * 响应 URI 的**回程部分**：剥掉 query 与 fragment，只留 scheme/authority/path。
     * 响应参数（code / state / error）都在 query 里，不能参与回程比对。畸形 URI 返回 null，
     * 由 [AuthResponseGuard] 判成 redirect-mismatch（fail closed）。
     */
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

    internal companion object {
        private const val TAG = "WotbAuth"

        /**
         * 回程 intent 被重复交付时的失败 detail。调用方据此**不弹失败提示** —— 那不是一次新的登录失败，
         * 而是系统对同一个 intent 的第二次交付（dedupe 由 [processedResponseState] 保证）。
         */
        internal const val ALREADY_PROCESSED_DETAIL = "already-processed"

        /** 授权完成回程的 PendingIntent request code。 */
        private const val REQUEST_CODE_LOGIN = 0

        /** post-logout 回程的 PendingIntent request code（与登录区分，避免复用同一 PendingIntent）。 */
        private const val REQUEST_CODE_END_SESSION = 1

        private const val ERROR_PARAM = "error"
        private const val REFRESH_TIMEOUT_SECONDS = 30L

        @Volatile
        private var instance: AuthManager? = null

        /** 进程级单例（`applicationContext`）：认证交易因此能跨 Activity / 进程重建存活（靠加密存储）。 */
        internal fun getInstance(context: Context, activityClass: Class<*>): AuthManager {
            instance?.let { return it }
            return synchronized(this) {
                instance ?: AuthManager(context.applicationContext)
                    .also { it.hostActivityClass = activityClass }
                    .also { instance = it }
            }
        }

        /**
         * 恢复结果 → 会话快照的**唯一**投影：没有可用状态（条目缺失 / 解密失败 / JSON 损坏 / 超时）
         * 一律得到 [AuthSession.unauthenticated]，绝不抛、绝不返回半成品。
         */
        internal fun sessionOf(restored: net.openid.appauth.AuthState?): AuthSession =
            if (restored == null) AuthSession.unauthenticated() else project(restored)

        /**
         * 授权回程 intent 判定（MainActivity 与 [handleAuthorizationResult] 共用同一份实现）。
         *
         * AppAuth 的完成 / 取消 intent 一定带 response 或 exception extra；两者都没有就不是 auth 回程
         * （例如 replay intent），必须交回 replay ingress，不能被当成一次空的授权结果。
         */
        internal fun isAuthorizationIntent(intent: Intent?): Boolean {
            if (intent == null) return false
            return try {
                intent.hasExtra(AuthorizationResponse.EXTRA_RESPONSE) ||
                    intent.hasExtra(AuthorizationException.EXTRA_EXCEPTION)
            } catch (_: Exception) {
                false
            }
        }

        /** [sessionOf] / 交换 / 刷新共用的投影实现（`AuthState` → 对外快照）。 */
        private fun project(authState: net.openid.appauth.AuthState): AuthSession = AuthSession(
            accessToken = authState.accessToken,
            hasIdToken = !authState.idToken.isNullOrBlank(),
            expiresAtSeconds = authState.accessTokenExpirationTime?.let { it / 1000L },
            claims = decodeClaims(authState.accessToken)
        )

        /** 解码 access token JWT payload（前端拿它取 roles / preferred_username，对齐 keycloak-js `tokenParsed`）。 */
        private fun decodeClaims(accessToken: String?): Map<String, Any?>? {
            val payload = AuthSession.decodeJwtPayload(accessToken) ?: return null
            return try {
                val json = JSONObject(payload)
                json.keys().asSequence().associateWith { key -> json.opt(key) }
            } catch (_: Exception) {
                // payload 不是 JSON：当作没有 claims，绝不因此让整个会话不可用。
                null
            }
        }
    }
}
