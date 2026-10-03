package com.wotbtools.app.auth

/**
 * 不可变会话快照 —— Native 认证对外的**唯一**会话表示。
 *
 * 安全边界：只持有 access token（以及「是否存在 id token」这一位事实）与解码后的
 * claims；**绝不**持有 refresh token / authorization code / PKCE verifier / state / nonce。
 * 这些只存在于 [AuthSessionStore] 加密保存的 AppAuth `AuthState` JSON 内部，永远不进入本类型、
 * 不进入 bridge 回复、不进入日志。
 *
 * 纯 Kotlin：不引用 `android.*`，也不引用 `org.json`，因此有效期判定可在 `testDebugUnitTest`
 * 下完整覆盖。
 */
internal data class AuthSession(
    val accessToken: String?,
    val hasIdToken: Boolean,
    /** access token 到期时刻（epoch **秒**）；未知为 null。 */
    val expiresAtSeconds: Long?,
    /** access token JWT payload（roles / preferred_username 等，与 keycloak-js `tokenParsed` 对齐）；无则 null。 */
    val claims: Map<String, Any?>?
) {

    /**
     * 是否已认证。
     *
     * 刻意只表示「存在 access token」，**不**表示 token 仍未过期：过期由 [expiresAtSeconds] 单独表达，
     * 前端据此自行决定是否刷新（与 keycloak-js 的 `authenticated` + `tokenExpiresAt` 分工一致）。
     */
    val authenticated: Boolean get() = !accessToken.isNullOrBlank()

    /**
     * 当前 access token 是否至少在 [minValiditySeconds] 秒内仍然有效。
     *
     * 未知到期时间（null / 非正）**恒为 false**：宁可多刷新一次，也不把「不知道还剩多久」当成有效。
     */
    fun isValidFor(minValiditySeconds: Long, nowMillis: Long): Boolean {
        if (accessToken.isNullOrBlank()) return false
        val expiresAt = expiresAtSeconds ?: return false
        if (expiresAt <= 0L) return false
        if (nowMillis <= 0L) return false
        val remainingSeconds = expiresAt - nowMillis / 1000L
        return remainingSeconds > minValiditySeconds.coerceAtLeast(0L)
    }

    companion object {

        /** 全新未认证状态（无会话 / 会话已清 / 持久化数据损坏）。 */
        fun unauthenticated(): AuthSession = AuthSession(
            accessToken = null,
            hasIdToken = false,
            expiresAtSeconds = null,
            claims = null
        )

        /**
         * 把 JWT 拆成 header / payload / signature 三段并 base64url 解码。
         *
         * 返回 null 表示**形状不合法**（段数不对 / 段为空 / 段不是合法 base64url）——
         * 绝不返回部分结果、绝不抛。签名真实性由 Keycloak 与 token endpoint 保证，本地只看内容。
         *
         * 解码刻意手写而不是用 `android.util.Base64`：否则这个类就不再是纯 Kotlin，
         * 也无法作为普通 JVM 单测运行（Android SDK 的 stub 方法会抛异常）。JWT 只允许
         * base64url 字母表，因此不存在需要处理 `+` / `/` 的情况。
         */
        fun decodeJwtSegments(token: String?): List<String>? {
            val parts = token?.split('.') ?: return null
            if (parts.size != 3) return null
            val decoded = parts.map { decodeBase64Url(it) ?: return null }
            return decoded.map { String(it, Charsets.UTF_8) }
        }

        /**
         * 解码 JWT 的 payload 段；任何形状异常都返回 null（绝不抛、绝不部分解析）。
         *
         * 只做 base64url 解码 + 字符串返回：JSON 解析交给调用方（本文件不得引用 `org.json`）。
         */
        fun decodeJwtPayload(token: String?): String? = decodeJwtSegments(token)?.get(1)

        /** 严格的 base64url 解码：容忍缺失 padding，遇到字母表外的字符（含 `+` / `/`）返回 null。 */
        private fun decodeBase64Url(value: String): ByteArray? {
            if (value.isEmpty()) return null
            val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
            val output = java.io.ByteArrayOutputStream()
            var buffer = 0
            var bits = 0
            for (char in value) {
                if (char == '=') continue
                val index = alphabet.indexOf(char)
                if (index < 0) return null
                buffer = (buffer shl 6) or index
                bits += 6
                if (bits >= 8) {
                    bits -= 8
                    output.write((buffer shr bits) and 0xFF)
                }
            }
            return output.toByteArray()
        }
    }
}
