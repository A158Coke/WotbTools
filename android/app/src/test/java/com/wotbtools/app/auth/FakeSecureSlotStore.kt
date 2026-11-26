package com.wotbtools.app.auth

internal class FakeSecureSlotStore(initial: Map<String, String> = emptyMap()) : SecureSlotStore {

    private val values = LinkedHashMap<String, String>()
    private val cleared = mutableListOf<Pair<String, String>>()

    var failWrites: Boolean = false

    init {
        values.putAll(initial)
    }

    fun value(slot: String): String? = values[slot]

    fun clearedSlots(): List<String> = cleared.map { it.first }

    fun clearReasons(slot: String): List<String> = cleared.filter { it.first == slot }.map { it.second }

    override fun read(slot: String): String? = values[slot]

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
