package com.wotbtools.app.auth

internal class AuthTransactionStore(
    private val slots: SecureSlotStore,
    private val now: () -> Long = System::currentTimeMillis,
) {

    internal data class Transaction(
        val state: String,
        val redirectUri: String,
        val createdAtMillis: Long
    )

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

    fun load(): Transaction? {
        val raw = slots.read(SLOT) ?: return null
        val parsed = parse(raw)
        if (parsed == null) {
            slots.clear(SLOT, "malformed")
            return null
        }
        return parsed
    }

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
        internal const val SLOT = "auth_transaction_v1"

        private const val ENCODING_VERSION = "1"
        private const val FIELD_VERSION = "version"
        private const val FIELD_STATE = "state"
        private const val FIELD_REDIRECT_URI = "redirectUri"
        private const val FIELD_CREATED_AT = "createdAt"
    }
}
