package com.wotbtools.app.auth

/**
 * 进行中的 OIDC 授权交易（pending transaction）—— 与「已建立的会话」**完全分开**的状态域。
 *
 * 存什么、为什么：
 *  - `requestJson`：本次交易的 `AuthorizationRequest`（AppAuth `jsonSerializeString()`）。它带着
 *    这次交易的 `state` 与 PKCE `codeVerifier`。交换 token 时 AppAuth 会从响应 intent 里带回
 *    请求（verifier 随之回来），所以它**不是**交换的必要条件；这里持久化它是为了让回程校验有
 *    一个**独立于 intent 的**身份基准：response 的 `state` 必须等于我们当初存下来的 request 的
 *    `state`，这比只相信 intent 里携带的 request 更强（见 [AuthResponseGuard]）。
 *  - `redirectUri`：本次交易实际使用的回程 URI（HTTPS App Link 或 private scheme）。回程校验必须
 *    拿它比对，而不是在响应到达时重新探测 domain verification —— 运行中探测结果变化不应让一次
 *    合法回程变成 redirect-mismatch。
 *  - `createdAtMillis`：交易建立时刻（诊断与老化判断用；是否仍然有效由 callback 决定）。
 *
 * 生命周期边界（由 [AuthManager] 驱动，本类只负责存取与编码）：
 *  - 登录启动前写入；
 *  - 授权回程校验时读取（唯一读取方）；
 *  - 交换成功后与「会话已持久化」一起被消费（先写会话、再清交易）；
 *  - 取消 / provider 错误 / state 不匹配 / redirect 不匹配 / 交换失败 / 回程为空 ⇒ 只清本状态域。
 *
 * **绝不**因为会话缺失、会话损坏、会话刷新或 logout 被读取或清空 —— 反过来说，`authGetState`
 * 与 token 刷新也永远不会解析本域的内容。
 *
 * 编码刻意手写为行式 `key=value`（与 `ReplayIntentHandler` 的 metadata 编码同风格），
 * 不引用 `org.json` / `android.*`：这样本类可以在普通 JVM 单测里被完整覆盖。
 */
internal class AuthTransactionStore(
    private val slots: SecureSlotStore,
    private val now: () -> Long = System::currentTimeMillis,
) {

    internal data class Transaction(
        val requestJson: String,
        val redirectUri: String,
        val createdAtMillis: Long
    )

    /** 写入一份新的交易；false 表示没有落盘（调用方必须按「没有交易」处理）。 */
    fun save(requestJson: String, redirectUri: String): Boolean {
        if (requestJson.isBlank() || redirectUri.isBlank()) return false
        val payload = buildString {
            append(FIELD_VERSION).append('=').append(ENCODING_VERSION).append('\n')
            append(FIELD_REDIRECT_URI).append('=').append(redirectUri).append('\n')
            append(FIELD_CREATED_AT).append('=').append(now()).append('\n')
            append(FIELD_REQUEST).append('=').append(requestJson).append('\n')
        }
        return slots.write(SLOT, payload)
    }

    /** 读取当前交易；内容缺失或损坏 → 清空本 slot 并返回 null（绝不影响会话域）。 */
    fun load(): Transaction? {
        val raw = slots.read(SLOT) ?: return null
        val parsed = parse(raw)
        if (parsed == null) {
            slots.clear(SLOT, "malformed")
            return null
        }
        return parsed
    }

    /** 消费 / 放弃本交易（幂等）。会话域不受影响。 */
    fun clear(reason: String) {
        slots.clear(SLOT, reason)
    }

    private fun parse(raw: String): Transaction? {
        val fields = HashMap<String, String>()
        for (line in raw.split('\n')) {
            if (line.isEmpty()) continue
            val separator = line.indexOf('=')
            if (separator <= 0) return null
            fields[line.substring(0, separator)] = line.substring(separator + 1)
        }
        if (fields[FIELD_VERSION] != ENCODING_VERSION) return null
        val requestJson = fields[FIELD_REQUEST]?.takeIf { it.isNotBlank() } ?: return null
        val redirectUri = fields[FIELD_REDIRECT_URI]?.takeIf { it.isNotBlank() } ?: return null
        val createdAt = fields[FIELD_CREATED_AT]?.toLongOrNull()?.takeIf { it > 0L } ?: return null
        return Transaction(requestJson, redirectUri, createdAt)
    }

    internal companion object {
        /** 交易状态域独占的 slot：与 [AuthSessionStore.slot] 永不重叠。 */
        internal const val SLOT = "auth_transaction_v1"

        private const val ENCODING_VERSION = "1"
        private const val FIELD_VERSION = "version"
        private const val FIELD_REQUEST = "request"
        private const val FIELD_REDIRECT_URI = "redirectUri"
        private const val FIELD_CREATED_AT = "createdAt"
    }
}
