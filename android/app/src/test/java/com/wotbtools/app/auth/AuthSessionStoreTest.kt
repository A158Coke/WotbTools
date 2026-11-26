package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

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
        transactions.save("state-1", OidcConfiguration.HTTPS_REDIRECT_URI)

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
        val slots = FakeSecureSlotStore()
        val transactions = AuthTransactionStore(slots) { 1L }
        transactions.save("state-1", OidcConfiguration.PRIVATE_REDIRECT_URI)
        slots.write(AuthSessionStore.SLOT, "decryptable-but-not-auth-state")

        AuthSessionStore(slots).clear("deserialize-failed")

        assertEquals("state-1", transactions.load()?.state)
        assertEquals(OidcConfiguration.PRIVATE_REDIRECT_URI, transactions.load()?.redirectUri)
        assertFalse(slots.clearedSlots().contains(AuthTransactionStore.SLOT))
    }

    @Test
    fun aFreshProcessReadingTheSessionKeepsThePendingTransactionIntact() {
        val slots = FakeSecureSlotStore()
        AuthTransactionStore(slots) { 1L }.save("state-1", OidcConfiguration.HTTPS_REDIRECT_URI)

        val restartedSessions = AuthSessionStore(slots)
        assertNull(restartedSessions.load())

        val restartedTransaction = AuthTransactionStore(slots) { 2L }.load()
        assertEquals("state-1", restartedTransaction?.state)
        assertEquals(OidcConfiguration.HTTPS_REDIRECT_URI, restartedTransaction?.redirectUri)
        assertEquals(1L, restartedTransaction?.createdAtMillis)
    }
}
