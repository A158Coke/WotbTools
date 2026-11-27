package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RuntimeRecoveryTest {

    private val entry = MainActivity.LOCAL_APP_ENTRY
    private val replay = entry + "?" + ReplayDispatchPolicy.REPLAY_VIEW_MARKER

    @Test
    fun initialHomeLoadKilledBeforeLocationChangeRecoversTheRequestedEntry() {
        val recovery = RuntimeRecovery()
        recovery.requested(entry)
        assertEquals(entry, recovery.onKill(visible = true))
    }

    @Test
    fun pendingReplayColdStartKilledBeforeLocationChangeKeepsTheReplayTarget() {
        val recovery = RuntimeRecovery()
        recovery.requested(replay)
        recovery.committed("about:blank")
        assertEquals(replay, recovery.onKill(visible = true))
        assertEquals(replay, recovery.onCrash())
    }

    @Test
    fun backgroundEarlyKillRecoversOnResumeExactlyOnce() {
        val recovery = RuntimeRecovery()
        recovery.requested(replay)
        assertNull(recovery.onKill(visible = false))
        assertEquals(replay, recovery.onResume())
        assertNull(recovery.onResume())
    }

    @Test
    fun killAfterLocationChangeRecoversTheCommittedPage() {
        val recovery = RuntimeRecovery()
        recovery.requested(entry)
        recovery.committed("http://127.0.0.1:21653/?view=hof")
        assertEquals("http://127.0.0.1:21653/?view=hof", recovery.onKill(visible = true))
    }

    @Test
    fun nonLocalUrlsNeverBecomeTheTargetAndNothingRequestedFallsBackToEntry() {
        val recovery = RuntimeRecovery()
        recovery.committed("about:blank")
        recovery.requested("https://wotbtools.com/")
        assertEquals(entry, recovery.onCrash())
    }

    @Test
    fun closedRuntimeIsNeverRevived() {
        val recovery = RuntimeRecovery()
        recovery.requested(replay)
        assertNull(recovery.onKill(visible = false))
        recovery.close()
        assertNull(recovery.onResume())
        assertNull(recovery.onKill(visible = true))
        assertNull(recovery.onCrash())
    }
}
