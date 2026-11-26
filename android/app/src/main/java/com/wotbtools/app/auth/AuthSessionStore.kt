package com.wotbtools.app.auth

internal class AuthSessionStore(private val slots: SecureSlotStore) {

    fun load(): String? {
        val raw = slots.read(SLOT) ?: return null
        if (raw.isBlank()) {
            slots.clear(SLOT, "malformed")
            return null
        }
        return raw
    }

    fun save(authStateJson: String): Boolean {
        if (authStateJson.isBlank()) return false
        return slots.write(SLOT, authStateJson)
    }

    fun clear(reason: String) {
        slots.clear(SLOT, reason)
    }

    internal companion object {
        internal const val SLOT = "auth_session_v1"
    }
}
