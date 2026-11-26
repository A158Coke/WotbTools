package com.wotbtools.app.auth

internal data class AuthSession(
    val accessToken: String?,
    val hasIdToken: Boolean,
    val expiresAtSeconds: Long?,
    val claims: Map<String, Any?>?
) {

    val authenticated: Boolean get() = !accessToken.isNullOrBlank()

    fun isValidFor(minValiditySeconds: Long, nowMillis: Long): Boolean {
        if (accessToken.isNullOrBlank()) return false
        val expiresAt = expiresAtSeconds ?: return false
        if (expiresAt <= 0L) return false
        if (nowMillis <= 0L) return false
        val remainingSeconds = expiresAt - nowMillis / 1000L
        return remainingSeconds > minValiditySeconds.coerceAtLeast(0L)
    }

    companion object {

        fun unauthenticated(): AuthSession = AuthSession(
            accessToken = null,
            hasIdToken = false,
            expiresAtSeconds = null,
            claims = null
        )

        fun decodeJwtSegments(token: String?): List<String>? {
            val parts = token?.split('.') ?: return null
            if (parts.size != 3) return null
            val decoded = parts.map { decodeBase64Url(it) ?: return null }
            return decoded.map { String(it, Charsets.UTF_8) }
        }

        fun decodeJwtPayload(token: String?): String? = decodeJwtSegments(token)?.get(1)

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
