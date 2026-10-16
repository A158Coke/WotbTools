package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [RuntimeRecovery] 的纯 JVM 测试：content 进程在首个 `onLocationChange` 之前被杀时，
 * 恢复目标必须是已经请求的页面，后台 kill 的恢复标记只在真正恢复时消费，runtime 关闭后绝不复活。
 */
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
        recovery.committed("about:blank") // 初始 about:blank 不得覆盖目标
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
