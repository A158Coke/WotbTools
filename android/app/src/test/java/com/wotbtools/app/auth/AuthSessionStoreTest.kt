package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 会话状态域（[AuthSessionStore]）的确定性测试。
 *
 * 关键不变量与交易域互为镜像：会话域的缺失 / 为空 / 损坏 / 清理**只**影响会话域。
 * `AuthManager` 的 `authGetState`、token 读取、刷新与 logout 全部只经这一个域，
 * 因此「会话读取失败」再也不会顺手作废一笔进行中的登录。
 */
class AuthSessionStoreTest {

    private val sessionJson = """{"authorizationServiceConfiguration":{"issuer":"https://auth.wotbtools.com/realms/wotbtools"},"refreshToken":"r-1","accessToken":"a-1"}"""

    @Test
    fun absentSessionIsNullAndClearsNothing() {
        val slots = FakeSecureSlotStore()
        assertNull(AuthSessionStore(slots).load())
        assertTrue(slots.clearedSlots().isEmpty())
    }

    @Test
    fun sessionJsonRoundTripsUnchanged() {
        val slots = FakeSecureSlotStore()
        assertTrue(AuthSessionStore(slots).save(sessionJson))
        assertEquals(sessionJson, AuthSessionStore(slots).load())
    }

    @Test
    fun blankPayloadsAreNeverPersisted() {
        val slots = FakeSecureSlotStore()
        assertFalse(AuthSessionStore(slots).save(""))
        assertFalse(AuthSessionStore(slots).save("   "))
        assertNull(slots.value(AuthSessionStore.SLOT))
    }

    @Test
    fun blankStoredSessionIsClearedAndReportedAsAbsent() {
        val slots = FakeSecureSlotStore(mapOf(AuthSessionStore.SLOT to "   "))
        assertNull(AuthSessionStore(slots).load())
        assertEquals(listOf(AuthSessionStore.SLOT), slots.clearedSlots())
        assertEquals(listOf("malformed"), slots.clearReasons(AuthSessionStore.SLOT))
    }

    @Test
    fun clearingTheSessionNeverTouchesThePendingTransaction() {
        val slots = FakeSecureSlotStore()
        val transactions = AuthTransactionStore(slots) { 1L }
        transactions.save("""{"state":"state-1"}""", OidcConfiguration.HTTPS_REDIRECT_URI)

        AuthSessionStore(slots).clear("logout")

        assertNull(slots.value(AuthSessionStore.SLOT))
        assertEquals(
            OidcConfiguration.HTTPS_REDIRECT_URI,
            transactions.load()?.redirectUri
        )
        assertEquals(listOf(AuthSessionStore.SLOT), slots.clearedSlots())
    }

    @Test
    fun aCorruptedSessionIsClearedWithoutTouchingThePendingTransaction() {
        // 正是旧实现出错的路径：会话域损坏（密文解不开/内容不是 AuthState）只清会话域。
        val slots = FakeSecureSlotStore()
        val transactions = AuthTransactionStore(slots) { 1L }
        transactions.save("""{"state":"state-1"}""", OidcConfiguration.PRIVATE_REDIRECT_URI)
        slots.write(AuthSessionStore.SLOT, "decryptable-but-not-auth-state")

        AuthSessionStore(slots).clear("deserialize-failed")

        assertEquals(
            "state-1",
            transactions.load()?.let { Regex("\"state\":\"([^\"]+)\"").find(it.requestJson)?.groupValues?.get(1) }
        )
        assertFalse(slots.clearedSlots().contains(AuthTransactionStore.SLOT))
    }

    @Test
    fun aFreshProcessReadingTheSessionKeepsThePendingTransactionIntact() {
        // 进程重建：同一份 slot 之上新建两个状态域对象；WebView init 只读会话域。
        val slots = FakeSecureSlotStore()
        AuthTransactionStore(slots) { 1L }.save("""{"state":"state-1"}""", OidcConfiguration.HTTPS_REDIRECT_URI)

        val restartedSessions = AuthSessionStore(slots)
        assertNull(restartedSessions.load())

        val restartedTransaction = AuthTransactionStore(slots) { 2L }.load()
        assertEquals(OidcConfiguration.HTTPS_REDIRECT_URI, restartedTransaction?.redirectUri)
        assertEquals(1L, restartedTransaction?.createdAtMillis)
    }
}
