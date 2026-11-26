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

    // ── 授权结果 ──

    /**
     * 处理授权结果 intent（MainActivity 的 onCreate / onNewIntent / onActivityResult 都调这里）。
     *
     * 三条路径都必须收敛到「可复用的未认证」或「已认证」，绝不留下卡死状态：
     *  - 空 intent / RESULT_CANCELED / 缺少响应与异常 → [AuthFailureReason.CANCELLED]；
     *  - 响应存在 → 先过 [AuthResponseGuard]（交易身份 + redirect 归属 + code 存在性 + 错误分类），
     *    再换 token；
     *  - 交换失败 → 只消费这笔交易，已有会话不受影响（见 [exchangeAuthorizationCode]）。
     *
     * **失败路径的清理一律按身份**：只有能证明这次回程属于当前交易时才消费它，否则对这次回程
     * fail closed 并原样保留当前交易（陈旧 / 外来的 callback 不得作废一笔新登录）。
     *
     * 同一个 intent 被系统重复交付时直接跳过（见 [processedResponseState]）：授权码只能用一次。
     */
    internal fun handleAuthorizationResult(intent: Intent?): AuthResult {
        // 同一个回程 intent 重复投递：什么都不做（既不能重复换码，也不能因此清掉已有会话）。
        if (AuthManager.isAuthorizationIntent(intent) && alreadyProcessed(intent)) {
            Log.d(TAG, "auth-result ignored reason=already-processed")
            return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, AuthManager.ALREADY_PROCESSED_DETAIL)
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
            // 回程失败（含库判定的 STATE_MISMATCH）只允许作废**它自己那一笔**交易：
            //  - 回程 URI 里带回的 `state` 与当前交易身份一致 ⇒ 是本次交易的失败 ⇒ 按身份清掉；
            //  - 带回的 state 对不上，或根本读不出 state（用户直接返回、浏览器关闭）⇒ 归属无法证明，
            //    对这次回程 fail closed，但**原样保留**当前交易（用户可能已经开始了一笔更新的登录）。
            // 已有会话与这些都无关：它不是这次失败证明为无效的东西。
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
            // 没有响应对象 ⇒ 无法证明这次回程属于哪一笔交易（典型：用户取消 / 直接返回）。
            // 对这次回程 fail closed，但**不**清当前交易：陈旧或无法归属的回程不得作废一笔新登录。
            Log.d(TAG, "auth-result outcome=cancelled reason=no-response transaction=preserved")
            return AuthResult.Failure(AuthFailureReason.CANCELLED, "no-response")
        }

        // 回程校验的唯一依据是**交易域**：当前交易的身份（state）与实际使用的回程 URI。
        // 交易不存在（回程是伪造的 / 已被消费）时 fail closed，且绝不去动会话域。
        val transaction = transactions.load()
        if (transaction == null) {
            Log.d(TAG, "auth-result outcome=rejected reason=no-pending-transaction")
            return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, AuthManager.NO_PENDING_TRANSACTION_DETAIL)
        }

        val guardFailure = AuthResponseGuard.verify(
            // 交易归属校验的两个操作数必须来自**两处独立来源**：
            //  - expectedState：我们自己持久化那笔交易的身份（state）；
            //  - responseState：OAuth 响应真正携带回来的 `response.state`。
            // 刻意**不**用 `response.request.state`：那是响应里自带的 request，与自己比较是自指
            // （恒等），等于这道独立校验不存在。
            expectedState = transaction.state,
            responseState = response.state,
            expectedRedirectUri = transaction.redirectUri,
            responseRedirectUri = redirectUriOf(intent?.data),
            code = response.authorizationCode,
            error = response.additionalParameters[ERROR_PARAM]
        )
        if (guardFailure != null) {
            // 只有能证明属于当前交易的回程才允许消费它：state 不一致（陈旧 / 外来）时
            // clearIfState 返回 false，当前交易原样保留。
            val consumed = transactions.clearIfState(response.state, "guard-${guardFailure.logToken}")
            Log.d(TAG, "auth-result outcome=rejected reason=${guardFailure.logToken} " +
                "detail=${guardFailure.detail} transaction=${if (consumed) "consumed" else "preserved"}")
            return guardFailure
        }

        // 只有走到这里才说明回程**属于当前交易**（guard 已用 response.state 与交易身份比对过），
        // 因此这笔交易可以被这次交换按身份消费。
        exchangeAuthorizationCode(response, transaction.state)
        // 记下这次响应的 identity：同一个 intent 再次被交付时直接跳过，避免用已消耗的授权码再换一次。
        processedResponseState = response.request.state
        // 交换是异步的：这里的结果表示「已接受并开始交换」，真正的会话由 authChanged 事件与随后的
        // authGetAccessToken 表达（bridge 不等待 token endpoint）。
        Log.d(TAG, "auth-result outcome=exchanging")
        return AuthResult.ExchangeStarted
    }

    // ── 回程 URI 解析（归一化 + 身份）──

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

    /**
     * 回程 URI 里带回的 `state`（交易身份）。读不出就返回 null ⇒ 调用方按「归属无法证明」处理：
     * 对这次回程 fail closed，但**不**清当前交易（陈旧 / 外来回程不得作废一笔新登录）。
     */
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
