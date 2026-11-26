package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthTransactionStoreTest {

    private val redirectUri = OidcConfiguration.PRIVATE_REDIRECT_URI
    private val stateA = "state-a"
    private val stateB = "state-b"

    private fun store(slots: SecureSlotStore, now: Long = 1_700_000_000_000L) =
        AuthTransactionStore(slots) { now }

    @Test
    fun theTwoStateDomainsNeverShareASlot() {
        assertNotEquals(AuthTransactionStore.SLOT, AuthSessionStore.SLOT)
    }

    @Test
    fun absentSlotMeansNoPendingTransaction() {
        val slots = FakeSecureSlotStore()
        assertNull(store(slots).load())
        assertTrue(slots.clearedSlots().isEmpty())
    }

    @Test
    fun savedTransactionRoundTripsItsIdentityRedirectAndTimestamp() {
        val slots = FakeSecureSlotStore()
        assertTrue(store(slots).save(stateA, redirectUri))

        val loaded = store(slots).load()
        assertEquals(stateA, loaded?.state)
        assertEquals(redirectUri, loaded?.redirectUri)
        assertEquals(1_700_000_000_000L, loaded?.createdAtMillis)
    }

    @Test
    fun blankInputsAreNeverPersisted() {
        val slots = FakeSecureSlotStore()
        assertFalse(store(slots).save("", redirectUri))
        assertFalse(store(slots).save(stateA, "   "))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun failedWriteIsReportedAndLeavesNoStaleTransaction() {
        val slots = FakeSecureSlotStore(
            mapOf(AuthTransactionStore.SLOT to "version=1\nstate=$stateB\nredirectUri=$redirectUri\ncreatedAt=1\n")
        )
        slots.failWrites = true
        assertFalse(store(slots).save(stateA, redirectUri))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun malformedPayloadClearsOnlyTheTransactionSlot() {
        val sessionJson = """{"refreshToken":"r"}"""
        val slots = FakeSecureSlotStore(
            mapOf(
                AuthTransactionStore.SLOT to "not-a-valid-payload",
                AuthSessionStore.SLOT to sessionJson
            )
        )

        assertNull(store(slots).load())
        assertEquals(listOf(AuthTransactionStore.SLOT), slots.clearedSlots())
        assertEquals(sessionJson, slots.value(AuthSessionStore.SLOT))
    }

    @Test
    fun unknownEncodingVersionOrMissingFieldsAreMalformed() {
        val cases = listOf(
            "version=2\nstate=$stateA\nredirectUri=$redirectUri\ncreatedAt=1\n",
            "version=1\nredirectUri=$redirectUri\ncreatedAt=1\n",
            "version=1\nstate=$stateA\ncreatedAt=1\n",
            "version=1\nstate=$stateA\nredirectUri=$redirectUri\ncreatedAt=0\n",
            "version=1\nstate=$stateA\nredirectUri=$redirectUri\ncreatedAt=not-a-number\n"
        )
        cases.forEach { payload ->
            val slots = FakeSecureSlotStore(mapOf(AuthTransactionStore.SLOT to payload))
            assertNull("payload=$payload", store(slots).load())
            assertEquals("payload=$payload", listOf(AuthTransactionStore.SLOT), slots.clearedSlots())
        }
    }


    @Test
    fun consumingWithTheMatchingStateClearsTheTransaction() {
        val slots = FakeSecureSlotStore()
        val transactions = store(slots)
        transactions.save(stateB, redirectUri)

        assertTrue(transactions.clearIfState(stateB, "exchanged"))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun aStaleCallbackNeverClearsTheCurrentTransaction() {
        val slots = FakeSecureSlotStore()
        val transactions = store(slots)
        transactions.save(stateA, redirectUri)
        transactions.save(stateB, redirectUri)

        assertFalse(transactions.clearIfState(stateA, "guard-state_mismatch"))
        assertEquals(stateB, transactions.load()?.state)
        assertEquals(redirectUri, transactions.load()?.redirectUri)
        assertTrue(slots.clearedSlots().isEmpty())

        assertTrue(transactions.clearIfState(stateB, "exchanged"))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun anUnprovableCallbackNeverClearsTheTransaction() {
        val slots = FakeSecureSlotStore()
        val transactions = store(slots)
        transactions.save(stateB, redirectUri)

        assertFalse(transactions.clearIfState(null, "auth-exception"))
        assertFalse(transactions.clearIfState("", "auth-exception"))
        assertFalse(transactions.clearIfState("   ", "auth-exception"))
        assertEquals(stateB, transactions.load()?.state)
    }

    @Test
    fun consumingWithNoPendingTransactionIsANoOp() {
        val slots = FakeSecureSlotStore()
        assertFalse(store(slots).clearIfState(stateB, "exchanged"))
        assertTrue(slots.clearedSlots().isEmpty())
    }

    @Test
    fun clearingTheTransactionNeverTouchesTheSession() {
        val sessionJson = """{"accessToken":"a"}"""
        val slots = FakeSecureSlotStore(mapOf(AuthSessionStore.SLOT to sessionJson))
        val transactions = store(slots)
        transactions.save(stateB, redirectUri)

        transactions.clearIfState(stateB, "exchanged")

        assertNull(slots.value(AuthTransactionStore.SLOT))
        assertEquals(sessionJson, slots.value(AuthSessionStore.SLOT))
        assertEquals(listOf(AuthTransactionStore.SLOT), slots.clearedSlots())
    }

    @Test
    fun aPendingTransactionSurvivesSessionReadsCorruptionAndLogout() {
        val slots = FakeSecureSlotStore()
        store(slots).save(stateA, redirectUri)

        val sessions = AuthSessionStore(slots)
        assertNull(sessions.load())
        slots.write(AuthSessionStore.SLOT, "corrupted-session-payload")
        sessions.clear("deserialize-failed")

        sessions.clear("logout")

        val transaction = store(slots).load()
        assertEquals(stateA, transaction?.state)
        assertEquals(redirectUri, transaction?.redirectUri)
        assertFalse(slots.clearedSlots().contains(AuthTransactionStore.SLOT))
    }
}
