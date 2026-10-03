package com.wotbtools.app.auth

/**
 * 已建立的会话状态域：只保存 AppAuth `AuthState` 的序列化 JSON。
 *
 * `AuthState` 是 refresh token、access token、id token 与到期时间的**唯一**落盘形态；本类不做
 * 语义解析（那是 AppAuth 的 `AuthState.jsonDeserialize`），只保证：
 *
 *  - 一个独占 slot（与 [AuthTransactionStore.slot] 永不重叠）；
 *  - 任何读取失败 / 内容为空 ⇒ 清空**本 slot**并返回 null；
 *  - 绝不读取、绝不清理进行中的授权交易 —— 会话缺失（例如刚启动、刚 logout、或密文损坏）
 *    不是「交易作废」的理由，反过来也一样。
 *
 * 纯 Kotlin（不引用 `android.*` / `org.json`），因此两个状态域的隔离可以在 JVM 单测里被
 * 确定性地证明（见 `AuthSessionStoreTest`）。
 */
internal class AuthSessionStore(private val slots: SecureSlotStore) {

    /** 读取会话 JSON；缺失或为空 → null（空内容会顺带清掉本 slot）。 */
    fun load(): String? {
        val raw = slots.read(SLOT) ?: return null
        if (raw.isBlank()) {
            slots.clear(SLOT, "malformed")
            return null
        }
        return raw
    }

    /** 写入会话 JSON；false 表示没有落盘（调用方绝不能因此假装已登录）。 */
    fun save(authStateJson: String): Boolean {
        if (authStateJson.isBlank()) return false
        return slots.write(SLOT, authStateJson)
    }

    /** 清空会话（logout / 刷新失败 / 密文损坏）。交易域不受影响。 */
    fun clear(reason: String) {
        slots.clear(SLOT, reason)
    }

    internal companion object {
        /** 会话状态域独占的 slot：与 [AuthTransactionStore.SLOT] 永不重叠。 */
        internal const val SLOT = "auth_session_v1"
    }
}
