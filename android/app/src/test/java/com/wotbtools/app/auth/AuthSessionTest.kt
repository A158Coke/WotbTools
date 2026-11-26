package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthSessionTest {

    private val now = 1_700_000_000_000L

    @Test
    fun freshSessionIsUnauthenticatedAndInvalid() {
        val session = AuthSession.unauthenticated()
        assertFalse(session.authenticated)
        assertNull(session.accessToken)
        assertNull(session.expiresAtSeconds)
        assertNull(session.claims)
        assertFalse(session.isValidFor(0, now))
        assertFalse(session.isValidFor(60, now))
    }

    @Test
    fun tokenValidWellBeyondTheRequestedWindowIsUsable() {
        val session = session(expiresInSeconds = 600)
        assertTrue(session.authenticated)
        assertTrue(session.isValidFor(0, now))
        assertTrue(session.isValidFor(300, now))
    }

    @Test
    fun tokenExpiringInsideTheRequestedWindowIsNotUsable() {
        val session = session(expiresInSeconds = 120)
        assertFalse(session.isValidFor(300, now))
        assertTrue(session.isValidFor(60, now))
    }

    @Test
    fun alreadyExpiredTokenIsNeverUsable() {
        val session = session(expiresInSeconds = -10)
        assertTrue(session.authenticated)
        assertFalse(session.isValidFor(0, now))
    }

    @Test
    fun unknownExpiryFailsClosed() {
        val session = AuthSession(
            accessToken = "header.payload.signature",
            hasIdToken = false,
            expiresAtSeconds = null,
            claims = null
        )
        assertTrue(session.authenticated)
        assertFalse(session.isValidFor(0, now))
        assertFalse(session.isValidFor(60, now))
    }

    @Test
    fun blankAccessTokenIsNotAuthenticated() {
        listOf("", "   ", null).forEach { token ->
            val session = AuthSession(token, false, now / 1000 + 600, null)
            assertFalse("token=$token", session.authenticated)
            assertFalse("token=$token", session.isValidFor(0, now))
        }
    }

    @Test
    fun negativeMinValidityIsNotRelaxed() {
        val session = session(expiresInSeconds = 5)
        assertTrue(session.isValidFor(-100, now))
        assertFalse(session.isValidFor(10, now))
    }

    @Test
    fun jwtPayloadIsDecodedAndMalformedTokensReturnNull() {
        val payload = "eyJzdWIiOiJ1MSIsInJvbGVzIjpbImFkbWluIl19"
        assertEquals("""{"sub":"u1","roles":["admin"]}""", AuthSession.decodeJwtPayload("h.$payload.s"))
        assertEquals("""{"a":1}""", AuthSession.decodeJwtPayload("h.eyJhIjoxfQ.s"))
        assertEquals(
            listOf("""{"alg":"RS256"}""", """{"sub":"u1"}""", "sig"),
            AuthSession.decodeJwtSegments("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln")
        )
    }

    @Test
    fun malformedTokensNeverThrow() {
        listOf(
            null,
            "",
            "not-a-jwt",
            "a.b",
            "a.b.c.d",
            "a!!.b!!.c!!",
            "h..s"
        ).forEach { token ->
            assertNull("token=$token", AuthSession.decodeJwtPayload(token))
            assertNull("token=$token", AuthSession.decodeJwtSegments(token))
        }
    }

    private fun session(expiresInSeconds: Long): AuthSession = AuthSession(
        accessToken = "header.payload.signature",
        hasIdToken = true,
        expiresAtSeconds = now / 1000 + expiresInSeconds,
        claims = emptyMap()
    )
}
