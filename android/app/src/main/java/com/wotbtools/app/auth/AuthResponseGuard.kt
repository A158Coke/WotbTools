package com.wotbtools.app.auth

/**
 * 授权响应的**我方**校验边界（纯逻辑，无 `android.*` / `org.json`）。
 *
 * ── 谁负责哪些检查（刻意划线，避免第二份安全规则）──
 *
 * **AppAuth 库拥有**：
 *  - `AuthorizationResponse.fromIntent` / `AuthorizationManagementActivity` 内部把响应 URI 的
 *    `state` 与它自己保存的 request `state` 比较，不一致直接丢弃并回 `STATE_MISMATCH`；
 *  - `nonce` 校验、PKCE verifier 的持有与使用（verifier 存在 request 里，交换时由
 *    `AuthorizationResponse.createTokenExchangeRequest()` 带出）；
 *  - token endpoint 通信本身（含 id_token 解析）。
 *
 * **我方拥有（本文件的全部职责）**：
 *  1. **交易归属**：响应携带的 `state` 必须等于**本次交易**（[AuthTransactionStore] 里持久化的
 *     `AuthorizationRequest`）的 `state`。库的比较用的是 intent 里随响应一起回来的 request；
 *     我们比较的是自己独立持久化的那一份，因此即使 intent 里的请求缺失或被替换，也不会有
 *     一次响应被算作「我们发起的交易」。不匹配即 fail closed（[AuthFailureReason.STATE_MISMATCH]）。
 *  2. **回程 URI 归属**：响应到达的 redirect URI 必须是**本次交易**实际使用的那一条（HTTPS App
 *     Link 或 private scheme，交易开始时选定并随交易持久化）——不同即 fail closed。
 *  3. 成功路径上必须存在有效 `code`；IdP 的 `error` 归一化成 [AuthFailureReason.PROVIDER_ERROR]，
 *     其中「用户取消家族」（`access_denied` / `user_cancelled` / `login_required`）归一化成
 *     [AuthFailureReason.CANCELLED]，让调用方能把「用户主动取消」当成可复用未认证状态而不是故障。
 *
 * 这里不做任何网络调用、不解析 token、不写日志、不落盘 —— 清理与持久化由 [AuthManager] 决定，
 * 且只清它认为该清的那个状态域。
 */
internal object AuthResponseGuard {

    /** 与 OAuth 2.0 (RFC 6749 §4.1.2.1) 对齐的取消家族；大小写不敏感。 */
    private val CANCELLED_ERRORS = setOf(
        "access_denied",
        "user_cancelled",
        "user_canceled",
        "login_required"
    )

    /**
     * 取消家族判定（单一 SSOT）。
     *
     * 供两条路径共用：本文件的响应校验，以及 [AuthManager] 处理 IdP 经 `?error=` 回程时的异常分类
     * —— 同一个 error 字符串绝不允许在第二处维护第二份集合。
     */
    internal fun isCancelledProviderError(error: String?): Boolean =
        error?.trim()?.lowercase() in CANCELLED_ERRORS

    /**
     * 校验一次授权响应。
     *
     * @param expectedState 本次交易持久化的 request 的 `state`（我们自己的那份）。
     * @param responseState 响应携带的 `state`。
     * @param expectedRedirectUri 本次交易实际使用的回程 URI（交易开始时选定并随交易持久化）。
     * @param responseRedirectUri 实际收到响应的回程 URI（调用方剥掉 query / fragment 后的形状）。
     * @param code 响应携带的 authorization code（可空）。
     * @param error IdP 返回的 `error`（可空）。
     * @return null 表示「响应确实属于本次交易且形状合法、可以去换 token」；否则是本次失败的显式原因。
     */
    internal fun verify(
        expectedState: String?,
        responseState: String?,
        expectedRedirectUri: String?,
        responseRedirectUri: String?,
        code: String?,
        error: String?
    ): AuthResult.Failure? {
        val expected = expectedState?.takeIf { it.isNotBlank() }
            ?: return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, "missing-expected-state")
        val actual = responseState?.takeIf { it.isNotBlank() }
            ?: return AuthResult.Failure(AuthFailureReason.STATE_MISMATCH, "missing-response-state")
        if (expected != actual) {
            return AuthResult.Failure(AuthFailureReason.STATE_MISMATCH, "state")
        }

        val expectedRedirect = OidcConfiguration.normalizeRedirectUri(expectedRedirectUri)
        val actualRedirect = OidcConfiguration.normalizeRedirectUri(responseRedirectUri)
        if (expectedRedirect == null || actualRedirect == null || expectedRedirect != actualRedirect) {
            return AuthResult.Failure(AuthFailureReason.REDIRECT_MISMATCH, "redirect-uri")
        }

        val providerError = error?.trim()?.takeIf { it.isNotEmpty() }
        if (providerError != null) {
            return if (isCancelledProviderError(providerError)) {
                AuthResult.Failure(AuthFailureReason.CANCELLED, "provider-cancelled")
            } else {
                AuthResult.Failure(AuthFailureReason.PROVIDER_ERROR, "provider-error")
            }
        }

        if (code.isNullOrBlank()) {
            return AuthResult.Failure(AuthFailureReason.MISSING_CODE, "empty-code")
        }

        return null
    }
}
