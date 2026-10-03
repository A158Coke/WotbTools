package com.wotbtools.app.auth

/**
 * JVM 测试用的 [SecureSlotStore] 替身：只按 slot 记录明文，并允许注入「写失败」。
 *
 * 它刻意**不**模拟加密 —— 加密与 Keystore 是 `KeystoreSlotStore` 的职责，而本测试要证明的是
 * 状态域隔离：哪个 slot 被读、被写、被清。同时它把每次 `clear` 的 slot 与 reason 记下来，
 * 让「清 A 的时候有没有碰 B」可以被直接断言，而不是靠日志。
 */
internal class FakeSecureSlotStore(initial: Map<String, String> = emptyMap()) : SecureSlotStore {

    private val values = LinkedHashMap<String, String>()
    private val cleared = mutableListOf<Pair<String, String>>()

    /** true 时所有写入失败（用于验证调用方的 fail-closed 姿态）。 */
    var failWrites: Boolean = false

    init {
        values.putAll(initial)
    }

    fun value(slot: String): String? = values[slot]

    fun clearedSlots(): List<String> = cleared.map { it.first }

    fun clearReasons(slot: String): List<String> = cleared.filter { it.first == slot }.map { it.second }

    override fun read(slot: String): String? = values[slot]

    /**
     * 写入失败时**不留下任何旧值** —— 与 [SecureSlotStore.write] 的契约和
     * `KeystoreSlotStore` 的实现一致：留下旧值会让调用方读到一份它以为已经被替换掉的状态。
     */
    override fun write(slot: String, value: String): Boolean {
        if (failWrites) {
            values.remove(slot)
            cleared.add(slot to "write-failed")
            return false
        }
        values[slot] = value
        return true
    }

    override fun clear(slot: String, reason: String) {
        values.remove(slot)
        cleared.add(slot to reason)
    }
}
