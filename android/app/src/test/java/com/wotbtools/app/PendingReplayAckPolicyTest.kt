package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingReplayAckPolicyTest {

    private val pendingA = "3f2b9c1e-7d4a-4b8e-9f01-2c6d5a7e8b90"
    private val pendingB = "8a1d0f45-2e6b-4c37-9a58-7d3f1b2c4e60"

    @Test
    fun ackNamingTheCurrentPendingIsAccepted() {
        assertEquals(PendingReplayAckResult.SUCCESS, PendingReplayAckPolicy.decide(pendingA, pendingA))
    }

    @Test
    fun ackForAReplacedPendingNeverClearsTheNewerOne() {
        assertEquals(PendingReplayAckResult.STALE, PendingReplayAckPolicy.decide(pendingB, pendingA))
        assertEquals(PendingReplayAckResult.STALE, PendingReplayAckPolicy.decide(pendingA, pendingB))
    }

    @Test
    fun ackWithoutACurrentPendingIsStaleNotSuccess() {
        assertEquals(PendingReplayAckResult.STALE, PendingReplayAckPolicy.decide(null, pendingA))
    }

    @Test
    fun ackWithoutIdentityIsRejectedEvenWhenAPendingExists() {
        listOf(null, "", "   ", "\t\n").forEach { expected ->
            val label = expected?.let { "'$it'" } ?: "null"
            assertEquals(
                "expected=$label + current=A 必须 MISSING_IDENTITY",
                PendingReplayAckResult.MISSING_IDENTITY,
                PendingReplayAckPolicy.decide(pendingA, expected)
            )
            assertEquals(
                "expected=$label + current=null 必须 MISSING_IDENTITY（不得退化成 STALE/SUCCESS）",
                PendingReplayAckResult.MISSING_IDENTITY,
                PendingReplayAckPolicy.decide(null, expected)
            )
        }
    }

    @Test
    fun blankExpectedIsRejectedEvenWhenCurrentIsBlank() {
        assertEquals(PendingReplayAckResult.MISSING_IDENTITY, PendingReplayAckPolicy.decide("", ""))
        assertEquals(PendingReplayAckResult.MISSING_IDENTITY, PendingReplayAckPolicy.decide("   ", "   "))
    }

    @Test
    fun identityComparisonIsExactWithoutFuzzyMatching() {
        listOf(
            pendingA.uppercase(),
            " $pendingA",
            "$pendingA ",
            "  $pendingA  ",
            pendingA.dropLast(1),
            pendingA.take(8),
            pendingA + pendingB
        ).forEach { other ->
            assertEquals(
                "「$other」不得被当成「$pendingA」",
                PendingReplayAckResult.STALE,
                PendingReplayAckPolicy.decide(other, pendingA)
            )
        }
    }
}
