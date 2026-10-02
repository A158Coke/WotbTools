package com.wotbtools.app.auth

/**
 * 授权响应的**我方**校验边界（纯逻辑，无 `android.*` / `org.json`）。
 *
 * ── 谁负责哪些检查（刻意划线，避免第二份安全规则）──
 *
 * **AppAuth 库拥有（我们绝不重复实现）**：
 *  - `state` 匹配：`AuthorizationManagementActivity.extractResponseData()` 在响应 URI 的 state 与
 *    request 的 state 不一致（或 request 无 state 而响应有）时**丢弃**响应，只回一个
 *    `AuthorizationRequestErrors.STATE_MISMATCH`。所以 [verify] 收下 `expectedState` 只用于
 *    「这次比较归库所有」的显式记录，绝不自己做字符串比较 —— 复制一份比较逻辑只会在库行为变化时
 *    产生两个互相矛盾的结论。
 *  - `nonce` 校验、PKCE verifier 的持有与使用：都在库内部（nonce 由 builder 自动生成并随请求保存，
 *    verifier 存在 request 里，交换时由 `AuthorizationResponse.createTokenExchangeRequest()` 带出）。
 *    响应里出现的 `nonce` 参数对我们没有任何校验职责。
 *  - token endpoint 通信本身（含 id_token 解析）由 `AuthorizationService` 负责。
 *
 * **我方拥有（本文件的全部职责）**：
 *  1. 回程 redirect URI 必须是**本次交易**实际使用的那一条（HTTPS App Link 或 private scheme，
 *     由 [OidcRedirectStrategy] 选定并随交易持久化）——不同即 fail closed；响应 URI 缺失也算不匹配。
 *  2. 成功路径上必须存在有效 `code`：空白 / 缺失即失败（绝不拿着空 code 去换 token）。
 *  3. 错误分类：IdP 的 `error` 归一化成 [AuthFailureReason.PROVIDER_ERROR]，其中「用户取消家族」
 *     （`access_denied` / `user_cancelled` / `login_required`）归一化成 [AuthFailureReason.CANCELLED]，
 *     让调用方能把「用户主动取消」当成可复用未认证状态而不是故障。
 *
 * 这里不做任何网络调用、不解析 token、不写日志。
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
     * @param expectedState 本次请求的 state。**只用于契约记录**：比较由 AppAuth 库完成（见类注释）。
     * @param expectedRedirectUri 本次交易实际使用的回程 URI（交易开始时选定并随交易持久化）。
     * @param responseRedirectUri 实际收到响应的回程 URI（调用方剥掉 query / fragment 后的形状）。
     * @param code 响应携带的 authorization code（可空）。
     * @param error IdP 返回的 `error`（可空）。
     * @return null 表示「响应形状合法、可以去换 token」；否则是本次失败的显式原因。
     */
    internal fun verify(
        expectedState: String?,
        expectedRedirectUri: String?,
        responseRedirectUri: String?,
        code: String?,
        error: String?
    ): AuthResult.Failure? {
        // 防御：库已经把 state 不匹配的响应丢掉了，走到这里 state 仍必须存在（契约要求）。
        // 这里只断言「存在」，不与 expectedState 比较 —— 比较归库所有。
        if (expectedState.isNullOrBlank()) {
            return AuthResult.Failure(AuthFailureReason.UNSUPPORTED, "missing-expected-state")
        }

        val expected = OidcConfiguration.normalizeRedirectUri(expectedRedirectUri)
        val actual = OidcConfiguration.normalizeRedirectUri(responseRedirectUri)
        if (expected == null || actual == null || expected != actual) {
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
