package com.wotbtools.app.auth

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Native 认证的编排 owner（process 级单例，持有 `applicationContext`）。
 *
 * ── ownership 边界 ──
 *  - 页面引擎（2.x System WebView / 3.0 GeckoView）**不拥有认证**：App 内不出现任何 IdP / provider host，登录只在 external
 *    user-agent（Custom Tabs，AppAuth 选择）里发生；回程固定 private scheme（[OidcRedirectStrategy]，2.1.0 起）：
 *    两条 URI 都登记在 Keycloak client；private scheme 之外仅剩兼容回退路径。
 *  - 本类只向 bridge 暴露 [AuthSession]（access token + claims + 到期秒）与显式失败原因；
 *    refresh token / 授权码 / PKCE verifier / state / nonce 永不出本类（只以密文落盘）。
 *  - 网络与 token 操作都不在主线程：发现走库的 AsyncTask，持久化与等待走 [executor]，
 *    bridge 调用线程（主线程）只提交请求、异步收结果。
 *
 * ── 两个状态域（本类最重要的不变量）──
 *  持久化被刻意拆成两个互不相干的域，各有独立 slot（见 [SecureSlotStore]）：
 *  [AuthTransactionStore] 只装「进行中的授权交易」，[AuthSessionStore] 只装「已建立的会话」。
 *  规则：`authGetState` / token 读取 / 刷新 / logout **只**读写会话域；回程校验**只**读写交易域；
 *  两者都不会解析或清理对方。因此「登录途中进程被杀 + App 重启读会话（甚至是坏会话）」不会
 *  作废那笔交易，反过来交易损坏也不会把用户已有的会话清掉。
 *  交易**只能按身份消费**（[AuthTransactionStore.clearIfState]）：只有回程带回的 `state` 与当前
 *  交易身份一致时才允许清空它，因此一笔陈旧 / 外来的 callback（旧登录的回程、库判定的
 *  STATE_MISMATCH、读不出 state 的取消）绝不可能作废用户已经开始的那笔新登录。
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

    /**
     * 认证的**两个互不相干的状态域**（见 [SecureSlotStore] 的类注释）：
     *  - [transactions]：进行中的授权交易（请求 + 本次回程 URI），只有登录启动、回程校验与
     *    交换成功这三处读写；
     *  - [sessions]：已建立的会话（AppAuth `AuthState`），`authGetState` / token 读取 / 刷新 /
     *    logout 只碰这一个域。
     *
     * 两者绝不互相解析、绝不互相清理：会话缺失或损坏不能让进行中的交易作废（否则进程在
     * 登录途中被回收后，回程 callback 会因交易被误清而永久失败），交易作废也不影响已有会话。
     */
    private val slots = KeystoreSlotStore(appContext)
    private val transactions = AuthTransactionStore(slots)
    private val sessions = AuthSessionStore(slots)

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

    private val listeners = mutableListOf<Listener>()

    private var session: AuthSession? = null

    /** 单飞 refresh：true 表示已有一个 refresh 在飞，后续调用只排队等结果。 */
    private var refreshInFlight = false
    private var sessionGeneration = 0L
    private var refreshGeneration: Long? = null
    private val refreshWaiters = mutableListOf<Pair<Long, CountDownLatch>>()

    /**
     * 宿主 `Activity` 类：只用于构造回程 `Intent`，避免 `auth` 包反向依赖 `MainActivity`。
     * 由 [Companion.getInstance] 注入一次，构造后不变。
     */
    private var hostActivityClass: Class<*>? = null

    private val browser = AuthBrowserFlow(appContext, transactions, lock, executor, mainHandler,
        ::activityClass, ::authorizationService, ::notifyListeners)
    private val callbackHandler = AuthCallbackHandler(transactions, ::exchangeAuthorizationCode)

    internal fun warmUp() = browser.warmUp()
    internal fun login(uiLocale: String? = null) = browser.login(uiLocale)
    internal fun handleAuthorizationResult(intent: Intent?): AuthResult = callbackHandler.handleAuthorizationResult(intent)

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

    /** 当前会话快照：内存命中优先，否则从会话状态域恢复（损坏 → 未认证，绝不崩溃）。 */
    internal fun currentSession(): AuthSession = synchronized(lock) { session }
        ?: restoreSession()
        ?: AuthSession.unauthenticated()

    /**
     * 内存未命中时从**会话域**恢复；失败即未认证（该 slot 已在读取处清空）。
     *
     * 刻意不读交易域：`authGetState` 是页面最常调用的一次 bridge 调用，它绝不能因为「有一份
     * 正在进行的登录交易」而解析失败，更不能把那笔交易清掉。
     */
    private fun restoreSession(): AuthSession? = synchronized(lock) {
        val authStateJson = sessions.load() ?: return null
        // 显式标注类型：catch 分支非局部 return，try 表达式因此是 AuthSession（非 null）。
        val restored: AuthSession = try {
            val authState = net.openid.appauth.AuthState.jsonDeserialize(authStateJson)
            sessionOf(authState)
        } catch (_: Exception) {
            // 解密成功但 JSON 形状不对：同样当作损坏，只清会话域。
            sessions.clear("deserialize-failed")
            return null
        }
        // 只有真的解析出 access token 才缓存；空状态不占内存，下次仍会重读存储。
        if (restored.authenticated) session = restored
        return restored
    }

    /** 回程 `Intent` 的目标 Activity；未注入即抛，属于编程错误（构造必须经 [Companion.getInstance]）。 */
    private fun activityClass(): Class<*> = hostActivityClass
        ?: error("AuthManager.getInstance must be used so the host activity class is known")

    private fun authorizationService(): AuthorizationService {
        synchronized(lock) {
            authService?.let { return it }
            val created = AuthorizationService(appContext)
            authService = created
            return created
        }
    }

    /**
     * 用授权码换 token。成功 → **先持久化会话、再消费交易**（顺序不可颠倒：中途进程死亡时
     * 「会话已存在 + 交易残留」只是下次登录会被覆盖，而反过来会得到「授权码已消耗但会话丢失」）。
     * 失败 → 只作废这次交易，已有会话不受影响（这次失败没有证明它无效）。
     *
     * 消费一律走 [AuthTransactionStore.clearIfState]：token endpoint 是异步的，回调到达时 slot 里
     * 可能已经换成**另一笔**更新的登录（用户在等待期间又点了一次登录）。这里只允许清掉自己那一笔。
     */
    private fun exchangeAuthorizationCode(response: AuthorizationResponse, transactionState: String) {
        val service = authorizationService()
        service.performTokenRequest(response.createTokenExchangeRequest()) { tokenResponse, ex ->
            if (tokenResponse == null || ex != null) {
                val consumed = transactions.clearIfState(transactionState, "exchange-failed")
                Log.d(TAG, "auth-exchange outcome=failure category=${ex?.error ?: "unknown"} " +
                    "transaction=${if (consumed) "consumed" else "preserved"}")
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
            val persisted = synchronized(lock) {
                val saved = sessions.save(authState.jsonSerializeString())
                if (!saved) sessions.clear("persist-failed")
                session = if (saved) sessionOf(authState) else null
                advanceSessionGenerationLocked()
                saved
            }
            if (!persisted) {
                val consumed = transactions.clearIfState(transactionState, "persist-failed")
                Log.d(TAG, "auth-exchange outcome=persist-failed " +
                    "transaction=${if (consumed) "consumed" else "preserved"}")
                notifyListeners()
                return@performTokenRequest
            }
            val consumed = transactions.clearIfState(transactionState, "exchanged")
            Log.d(TAG, "auth-exchange outcome=success transaction=${if (consumed) "consumed" else "preserved"}")
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
        browser.onMainThread { browser.endSession(idTokenHint) }
        Log.d(TAG, "auth-logout local-cleared")
        return true
    }

    /** id_token 只作为 end-session 的 hint；不存在就照样结束 SSO 会话。 */
    private fun idTokenHintOf(authState: net.openid.appauth.AuthState?): String? =
        authState?.idToken?.takeIf { it.isNotBlank() }

    /**
     * 清本地**会话**（内存 + 会话状态域）并通知；幂等。
     *
     * 刻意不触碰交易域：一次进行中的登录交易属于「用户还在外部浏览器里操作」这件事，
     * logout 只结束已经建立的会话，交易仍由回程 callback 决定（到期未回程的交易会被下一次
     * 登录覆盖）。这样两者互不牵连 —— 会话域的缺失/损坏永远不会作废一笔进行中的登录。
     */
    internal fun clearLocalSession() {
        synchronized(lock) {
            session = null
            sessions.clear("logout")
            advanceSessionGenerationLocked()
        }
        notifyListeners()
    }

    /** Called with lock held: logout/account replacement retires only the old refresh generation. */
    private fun advanceSessionGenerationLocked() {
        sessionGeneration++
        refreshGeneration = null
        refreshInFlight = false
        refreshWaiters.forEach { it.second.countDown() }
        refreshWaiters.clear()
    }

    // ── access token + 单飞 refresh ──

    /**
     * 取 access token：满足 [minValiditySeconds] 直接返回；否则经**单飞** refresh 后返回。
     *
     * 失败语义（与 wire 契约一致）：永久 token 拒绝清会话；网络/服务失败保留 cached session 并回 `refresh-failed`；本就没有会话回
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
        val generation = synchronized(lock) {
            // The snapshot may have been replaced between currentSession and registration.
            if (session?.accessToken != existing.accessToken) {
                return AuthResult.Failure(AuthFailureReason.REFRESH_FAILED, "session-replaced")
            }
            refreshWaiters.add(sessionGeneration to latch)
            if (!refreshInFlight) {
                refreshInFlight = true
                refreshGeneration = sessionGeneration
                isOwner = true
            }
            sessionGeneration
        }

        if (isOwner) startRefresh(generation) else Log.d(TAG, "auth-refresh joined")

        val completed = try {
            latch.await(REFRESH_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
        if (!completed) {
            synchronized(lock) { refreshWaiters.removeAll { it.second === latch } }
            Log.d(TAG, "auth-refresh outcome=timeout")
            return AuthResult.Failure(AuthFailureReason.REFRESH_FAILED, "timeout")
        }

        val refreshed = synchronized(lock) {
            if (sessionGeneration != generation) {
                return AuthResult.Failure(AuthFailureReason.REFRESH_FAILED, "session-replaced")
            }
            session
        }
        if (refreshed != null && refreshed.isValidFor(minValiditySeconds, System.currentTimeMillis())) {
            return AuthResult.Success(refreshed)
        }
        return AuthResult.Failure(AuthFailureReason.REFRESH_FAILED, "stale-after-refresh")
    }

    /**
     * 触发刷新。`AuthState.performActionWithFreshTokens` 内部已是「先判断再请求」，本类的
     * `refreshInFlight` 只保证**并发调用者共享一次请求**（库的 pending-action 队列不跨调用者聚合）。
     */
    private fun startRefresh(generation: Long) {
        val authState = synchronized(lock) {
            if (sessionGeneration != generation) null else loadAuthStateForRefresh()
        }
        if (authState == null) {
            synchronized(lock) {
                applyCurrentSessionUpdate(generation, sessionGeneration) {
                    session = null
                    sessions.clear("no-refresh-state")
                }
            }
            completeRefresh(generation, false)
            return
        }
        authState.performActionWithFreshTokens(authorizationService()) { accessToken, _, ex ->
            var success = false
            val applied = synchronized(lock) {
                // The guard and persistence share the logout/login lock: no stale write can race it.
                applyCurrentSessionUpdate(generation, sessionGeneration) {
                    if (ex != null || accessToken.isNullOrBlank()) {
                        if (shouldClearSessionAfterRefresh(
                                ex?.type == AuthorizationException.TYPE_OAUTH_TOKEN_ERROR, ex?.error
                            )) {
                            sessions.clear("refresh-rejected")
                            session = null
                        }
                    } else if (sessions.save(authState.jsonSerializeString())) {
                        session = sessionOf(authState)
                        success = true
                    } else {
                        sessions.clear("refresh-persist-failed")
                        session = null
                    }
                }
            }
            Log.d(TAG, "auth-refresh outcome=${if (!applied) "stale" else if (success) "success" else "failure"}")
            completeRefresh(generation, success)
        }
    }

    /** 从**会话域**恢复 AppAuth `AuthState`（刷新需要它携带的 refresh token）；损坏即 null。 */
    private fun loadAuthStateForRefresh(): net.openid.appauth.AuthState? {
        val authStateJson = sessions.load() ?: return null
        return try {
            net.openid.appauth.AuthState.jsonDeserialize(authStateJson)
        } catch (_: Exception) {
            sessions.clear("refresh-deserialize-failed")
            null
        }
    }

    /** 单飞收尾：释放所有 waiter 并结束本次 refresh。 */
    private fun completeRefresh(generation: Long, success: Boolean) {
        val (waiters, changed) = synchronized(lock) {
            if (refreshGeneration == generation) {
                refreshInFlight = false
                refreshGeneration = null
            }
            val pending = refreshWaiters.filter { it.first == generation }.map { it.second }
            refreshWaiters.removeAll { it.first == generation }
            pending to (!success && sessionGeneration == generation && session == null)
        }
        waiters.forEach { it.countDown() }
        // Retained transient failure emits no authChanged retry loop; stale callbacks notify nobody.
        if (changed) notifyListeners()
    }

    internal companion object {
        private const val TAG = "WotbAuth"
        private const val REFRESH_TIMEOUT_SECONDS = 30L

        /**
         * 回程 intent 被重复交付时的失败 detail。调用方据此**不弹失败提示** —— 那不是一次新的登录失败，
         * 而是系统对同一个 intent 的第二次交付（dedupe 由 [processedResponseState] 保证）。
         */
        internal const val ALREADY_PROCESSED_DETAIL = "already-processed"

        /**
         * 收到授权回程、但交易域里没有对应交易时的失败 detail（回程是伪造的，或这笔交易已被消费）。
         * 同样不该弹「登录失败」提示：用户没有发起一次新的登录。
         */
        internal const val NO_PENDING_TRANSACTION_DETAIL = "no-pending-transaction"


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

        /** The caller holds the session lock, so the check and store mutation are one operation. */
        internal fun applyCurrentSessionUpdate(expectedGeneration: Long, currentGeneration: Long,
            update: () -> Unit): Boolean {
            if (expectedGeneration != currentGeneration) return false
            update()
            return true
        }

        /** OAuth rejection is evidence of unusable credentials; transport/service failures are not. */
        internal fun shouldClearSessionAfterRefresh(isOAuthTokenError: Boolean, error: String?): Boolean =
            isOAuthTokenError && error in setOf("invalid_grant", "invalid_client", "unauthorized_client")

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
