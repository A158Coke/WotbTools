package com.wotbtools.app.auth

/**
 * 进行中的 OIDC 授权交易（pending transaction）—— 与「已建立的会话」**完全分开**的状态域。
 *
 * 存什么、为什么：
 *  - `state`：本次交易的 OAuth `state`，也就是这笔交易的**身份**。AppAuth 在
 *    `AuthorizationRequest.Builder` 构造时自动生成它，回程响应会把同一个值带回来，因此
 *    「响应属于哪一笔交易」可以用它精确判定（见 [clearIfState]）。刻意存这个标量而不是整个
 *    `AuthorizationRequest` JSON：交换 token 时 AppAuth 会从响应 intent 里带回请求（PKCE verifier
 *    随之回来），所以序列化请求**不是**交换的必要条件；把它存下来只会让身份判定依赖一次额外
 *    的反序列化。身份 = state，一个字段就够。
 *  - `redirectUri`：本次交易实际使用的回程 URI（HTTPS App Link 或 private scheme）。回程校验必须
 *    拿它比对，而不是在响应到达时重新探测 domain verification —— 运行中探测结果变化不应让一次
 *    合法回程变成 redirect-mismatch。
 *  - `createdAtMillis`：交易建立时刻（诊断用；是否仍然有效由 callback 决定）。
 *
 * 生命周期边界（由 [AuthManager] 驱动，本类只负责存取与编码）：
 *  - 登录启动**之前**写入；写失败 ⇒ 不得启动 external user-agent；
 *  - 授权回程读取（唯一读取方）；
 *  - 失败与消费**一律经 [clearIfState]**（compare-and-clear），本类不提供无条件清空：
 *    只有回程带回的 `state` 与当前交易身份一致时才会清空，因此一顿陈旧 / 外来的 callback
 *    不可能清掉「用户已经开始的那笔新交易」；
 *  - 交换成功后与「会话已持久化」一起被消费（先写会话、再清交易）。
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
        /** 交易身份：回程 `state` 必须与它完全一致，才允许消费这笔交易。 */
        val state: String,
        val redirectUri: String,
        val createdAtMillis: Long
    )

    /** 写入一份新的交易；false 表示没有落盘（调用方**不得**启动浏览器）。 */
    fun save(state: String, redirectUri: String): Boolean {
        if (state.isBlank() || redirectUri.isBlank()) return false
        val payload = buildString {
            append(FIELD_VERSION).append('=').append(ENCODING_VERSION).append('\n')
            append(FIELD_STATE).append('=').append(state).append('\n')
            append(FIELD_REDIRECT_URI).append('=').append(redirectUri).append('\n')
            append(FIELD_CREATED_AT).append('=').append(now()).append('\n')
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

    /**
     * 身份匹配的消费 / 放弃（compare-and-clear）：**只有**当前交易的身份等于 [expectedState]
     * 时才清空它并返回 true；否则原样保留并返回 false（调用方据此把这次回程判成陈旧 / 外来）。
     *
     * 这一条是「陈旧 callback 不得清掉新交易」的唯一执行点：
     * ```text
     * 交易 B 在 slot 里，收到旧回程 A  →  false（B 保持不变）
     * 随后收到 B 的回程                →  true（B 被消费）
     * ```
     * 本类刻意**不提供**无条件清空：交易只能按身份消费，这个不变量因此是编译期属性，而不是
     * 靠调用方自觉。
     */
    fun clearIfState(expectedState: String?, reason: String): Boolean {
        val expected = expectedState?.takeIf { it.isNotBlank() } ?: return false
        val current = load() ?: return false
        if (current.state != expected) return false
        slots.clear(SLOT, reason)
        return true
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
        val state = fields[FIELD_STATE]?.takeIf { it.isNotBlank() } ?: return null
        val redirectUri = fields[FIELD_REDIRECT_URI]?.takeIf { it.isNotBlank() } ?: return null
        val createdAt = fields[FIELD_CREATED_AT]?.toLongOrNull()?.takeIf { it > 0L } ?: return null
        return Transaction(state, redirectUri, createdAt)
    }

    internal companion object {
        /** 交易状态域独占的 slot：与 [AuthSessionStore.slot] 永不重叠。 */
        internal const val SLOT = "auth_transaction_v1"

        private const val ENCODING_VERSION = "1"
        private const val FIELD_VERSION = "version"
        private const val FIELD_STATE = "state"
        private const val FIELD_REDIRECT_URI = "redirectUri"
        private const val FIELD_CREATED_AT = "createdAt"
    }
}
