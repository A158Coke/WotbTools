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

internal class AuthManager private constructor(context: Context) {

    internal fun interface Listener {
        fun onAuthChanged()
    }

    private val appContext = context.applicationContext

    private val slots = KeystoreSlotStore(appContext)
    private val transactions = AuthTransactionStore(slots)
    private val sessions = AuthSessionStore(slots)

    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "wotb-auth")
    }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val lock = Any()

    private var authService: AuthorizationService? = null

    private val listeners = mutableListOf<Listener>()

    private var session: AuthSession? = null

    private var refreshInFlight = false
    private var sessionGeneration = 0L
    private var refreshGeneration: Long? = null
    private val refreshWaiters = mutableListOf<Pair<Long, CountDownLatch>>()

    private var hostActivityClass: Class<*>? = null

    private val browser = AuthBrowserFlow(appContext, transactions, lock, executor, mainHandler,
        ::activityClass, ::authorizationService, ::notifyListeners)
    private val callbackHandler = AuthCallbackHandler(transactions, ::exchangeAuthorizationCode)

    internal fun warmUp() = browser.warmUp()
    internal fun login(uiLocale: String? = null) = browser.login(uiLocale)
    internal fun handleAuthorizationResult(intent: Intent?): AuthResult = callbackHandler.handleAuthorizationResult(intent)


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
                Log.d(TAG, "auth-notify-failed category=${e.javaClass.simpleName}")
            }
        }
    }


    internal fun currentSession(): AuthSession = synchronized(lock) { session }
        ?: restoreSession()
        ?: AuthSession.unauthenticated()

    private fun restoreSession(): AuthSession? = synchronized(lock) {
        val authStateJson = sessions.load() ?: return null
        val restored: AuthSession = try {
            val authState = net.openid.appauth.AuthState.jsonDeserialize(authStateJson)
            sessionOf(authState)
        } catch (_: Exception) {
            sessions.clear("deserialize-failed")
            return null
        }
        if (restored.authenticated) session = restored
        return restored
    }

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
        val idTokenHint = idTokenHintOf(loadAuthStateForRefresh())
        clearLocalSession()
        browser.onMainThread { browser.endSession(idTokenHint) }
        Log.d(TAG, "auth-logout local-cleared")
        return true
    }

    private fun idTokenHintOf(authState: net.openid.appauth.AuthState?): String? =
        authState?.idToken?.takeIf { it.isNotBlank() }

    internal fun clearLocalSession() {
        synchronized(lock) {
            session = null
            sessions.clear("logout")
            advanceSessionGenerationLocked()
        }
        notifyListeners()
    }

    private fun advanceSessionGenerationLocked() {
        sessionGeneration++
        refreshGeneration = null
        refreshInFlight = false
        refreshWaiters.forEach { it.second.countDown() }
        refreshWaiters.clear()
    }


    internal fun accessTokenOrRefresh(minValiditySeconds: Long): AuthResult {
        val now = System.currentTimeMillis()
        val existing = currentSession()
        if (existing.isValidFor(minValiditySeconds, now)) {
            return AuthResult.Success(existing)
        }
        if (!existing.authenticated) {
            return AuthResult.Failure(AuthFailureReason.UNAUTHENTICATED, "no-session")
        }

        val latch = CountDownLatch(1)
        var isOwner = false
        val generation = synchronized(lock) {
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

    private fun loadAuthStateForRefresh(): net.openid.appauth.AuthState? {
        val authStateJson = sessions.load() ?: return null
        return try {
            net.openid.appauth.AuthState.jsonDeserialize(authStateJson)
        } catch (_: Exception) {
            sessions.clear("refresh-deserialize-failed")
            null
        }
    }

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
        if (changed) notifyListeners()
    }

    internal companion object {
        private const val TAG = "WotbAuth"
        private const val REFRESH_TIMEOUT_SECONDS = 30L

        internal const val ALREADY_PROCESSED_DETAIL = "already-processed"

        internal const val NO_PENDING_TRANSACTION_DETAIL = "no-pending-transaction"


        @Volatile
        private var instance: AuthManager? = null

        internal fun getInstance(context: Context, activityClass: Class<*>): AuthManager {
            instance?.let { return it }
            return synchronized(this) {
                instance ?: AuthManager(context.applicationContext)
                    .also { it.hostActivityClass = activityClass }
                    .also { instance = it }
            }
        }

        internal fun applyCurrentSessionUpdate(expectedGeneration: Long, currentGeneration: Long,
            update: () -> Unit): Boolean {
            if (expectedGeneration != currentGeneration) return false
            update()
            return true
        }

        internal fun shouldClearSessionAfterRefresh(isOAuthTokenError: Boolean, error: String?): Boolean =
            isOAuthTokenError && error in setOf("invalid_grant", "invalid_client", "unauthorized_client")

        internal fun sessionOf(restored: net.openid.appauth.AuthState?): AuthSession =
            if (restored == null) AuthSession.unauthenticated() else project(restored)

        internal fun isAuthorizationIntent(intent: Intent?): Boolean {
            if (intent == null) return false
            return try {
                intent.hasExtra(AuthorizationResponse.EXTRA_RESPONSE) ||
                    intent.hasExtra(AuthorizationException.EXTRA_EXCEPTION)
            } catch (_: Exception) {
                false
            }
        }

        private fun project(authState: net.openid.appauth.AuthState): AuthSession = AuthSession(
            accessToken = authState.accessToken,
            hasIdToken = !authState.idToken.isNullOrBlank(),
            expiresAtSeconds = authState.accessTokenExpirationTime?.let { it / 1000L },
            claims = decodeClaims(authState.accessToken)
        )

        private fun decodeClaims(accessToken: String?): Map<String, Any?>? {
            val payload = AuthSession.decodeJwtPayload(accessToken) ?: return null
            return try {
                val json = JSONObject(payload)
                json.keys().asSequence().associateWith { key -> json.opt(key) }
            } catch (_: Exception) {
                null
            }
        }
    }
}
