package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [AuthSession] 的纯 JVM 测试：有效期判定是「要不要刷新」的唯一依据，
 * 因此必须覆盖「未知到期 = 不可信」这条 fail-closed 规则（无 Robolectric）。
 */
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
        // 请求 300 秒有效期，但只剩 120 秒 → 必须先刷新。
        assertFalse(session.isValidFor(300, now))
        // 请求 60 秒：仍然够用。
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
        // 到期时间未知（unknown）绝不能被当成「有效」：宁可多刷新一次。
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
        // 负数不允许变成「比 0 更宽松」的判定；它按 0 处理。
        val session = session(expiresInSeconds = 5)
        assertTrue(session.isValidFor(-100, now))
        assertFalse(session.isValidFor(10, now))
    }

    @Test
    fun jwtPayloadIsDecodedAndMalformedTokensReturnNull() {
        // {"sub":"u1","roles":["admin"]}：base64url 长度正好是 4 的倍数（无需补 padding）。
        val payload = "eyJzdWIiOiJ1MSIsInJvbGVzIjpbImFkbWluIl19"
        assertEquals("""{"sub":"u1","roles":["admin"]}""", AuthSession.decodeJwtPayload("h.$payload.s"))
        // {"a":1}：base64url 长度 10，解码器必须容忍缺失 padding。
        assertEquals("""{"a":1}""", AuthSession.decodeJwtPayload("h.eyJhIjoxfQ.s"))
        // 三段都给出来（header / payload / signature 使用同一份解码）。
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
            // 非法 base64url 字符（`!`）在三段里都必须被拒绝。
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
