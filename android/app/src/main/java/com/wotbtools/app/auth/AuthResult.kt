package com.wotbtools.app.auth

/**
 * 认证失败原因的封闭集合 —— 唯一的「失败分类」SSOT。
 *
 * 每个 token 都是 Native 内部原因，绝不直接出现在 bridge wire 上：bridge 只把
 * [AuthResult.Failure.reason] 投影成契约里的 `unauthenticated` / `refresh-failed`
 * （见 `AuthManager.accessTokenOrRefresh`）。
 */
internal enum class AuthFailureReason {
    /** 响应缺失 / 来源无法归类（防御分支；state 比较归 AppAuth 库，不在这里）。 */
    STATE_MISMATCH,

    /** 回程 redirect URI 与本次交易使用的那个不一致 —— fail closed。 */
    REDIRECT_MISMATCH,

    /** 成功路径上 code 缺失或空白。 */
    MISSING_CODE,

    /** 用户取消（OAuth `access_denied` 家族 / RESULT_CANCELED / 空 intent）。 */
    CANCELLED,

    /** IdP 明确返回 `error`（非取消家族）。 */
    PROVIDER_ERROR,

    /** token endpoint 交换授权码失败。 */
    EXCHANGE_FAILED,

    /** 根本没有会话（从未登录 / 已登出 / 会话已被清）：没有可刷新或可返回的 token。 */
    UNAUTHENTICATED,

    /** refresh token 换取新 access token 失败。 */
    REFRESH_FAILED,

    /** 持久化数据缺失 / 解密失败 / JSON 损坏。 */
    CORRUPTED_STATE,

    /** 请求类型或流程形态不被支持。 */
    UNSUPPORTED
}

/**
 * 显式认证结果：要么拿到一份会话快照，要么拿到一个封闭的失败原因。
 *
 * 刻意不用异常表达控制流：所有失败都在 `AuthManager` 的返回边界被归类一次，调用方
 * （NativeBridge / MainActivity）只做投影与日志，不重新判断失败语义。
 *
 * 纯 Kotlin：不引用 `android.*`，也不引用 `org.json`（JVM 单测可直接覆盖）。
 */
internal sealed class AuthResult {

    /** 登录/交换成功，携带新的不可变会话快照。 */
    internal data class Success(val session: AuthSession) : AuthResult()

    /**
     * 授权码已被接受、正在**异步**换 token：结果只会经由 `authChanged` 通知与随后的
     * `authGetAccessToken` 表达（bridge 不等待 token endpoint）。
     *
     * 刻意不复用 [Success]：那会让「还没有会话」看起来像「已经登录」。
     */
    internal object ExchangeStarted : AuthResult()

    /** 失败：原因 + 可安全落日志的短说明（绝不含 token / code / claims / 完整 URI）。 */
    internal data class Failure(
        val reason: AuthFailureReason,
        val detail: String? = null
    ) : AuthResult() {
        /** 日志用的安全 token（`AuthFailureReason.SNAKE_CASE`）。 */
        val logToken: String = reason.name.lowercase()

        /**
         * `authGetAccessToken` 的 wire `error` 取值（契约封闭集合：`null | unauthenticated | refresh-failed`）。
         *
         * 「已经有会话但没刷新成功」→ `refresh-failed`（页面应重新登录）；其余一律 `unauthenticated`
         * （页面本来就没有可用会话来刷新）。
         */
        val wireError: String =
            if (reason == AuthFailureReason.REFRESH_FAILED) "refresh-failed" else "unauthenticated"
    }
}
