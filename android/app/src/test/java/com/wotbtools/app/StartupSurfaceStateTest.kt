package com.wotbtools.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [StartupSurfaceState] 的纯 JVM 测试：覆盖冷启动 / 内容绘制 / 恢复 / 门禁接管 / 重试，
 * 不依赖真实 GeckoView 或设备即可锁定启动面可见性规则。
 */
class StartupSurfaceStateTest {

    @Test
    fun coldStartShowsSurfaceUntilFirstContentfulPaint() {
        val state = StartupSurfaceState()
        assertTrue(state.visible)

        state.startLoading()
        assertTrue("冷启动加载期间必须保持启动面", state.visible)

        state.contentPainted()
        assertFalse("首个内容绘制后才移除启动面", state.visible)
    }

    @Test
    fun paintResetAfterPaintRestoresSurfaceUntilNextPaint() {
        val state = StartupSurfaceState()
        state.contentPainted()

        state.contentUnavailable()
        assertTrue("已绘制内容丢失时重新显示启动面", state.visible)

        state.contentPainted()
        assertFalse(state.visible)
    }

    @Test
    fun crashRecoveryCycleKeepsSurfaceUntilPaint() {
        val state = StartupSurfaceState()
        state.contentPainted()

        // GeckoWebRuntime 在 crash/kill 恢复加载前发出 contentUnavailable。
        state.contentUnavailable()
        state.startLoading()
        assertTrue("恢复加载期间保持启动面", state.visible)

        state.contentPainted()
        assertFalse(state.visible)
    }

    @Test
    fun gateHidesSurfaceAndSuppressesRecoverySignals() {
        val state = StartupSurfaceState()
        state.gateShown()
        assertFalse(state.visible)

        state.contentUnavailable()
        assertFalse("门禁接管时 paint reset 不得重新显示启动面", state.visible)

        state.contentPainted()
        assertFalse(state.visible)
    }

    @Test
    fun retryAfterGateShowsSurfaceUntilPaint() {
        val state = StartupSurfaceState()
        state.gateShown()

        state.startLoading()
        assertTrue("门禁解除后的重新加载重新显示启动面", state.visible)

        state.contentPainted()
        assertFalse(state.visible)
    }

    @Test
    fun repeatedPaintAndResetEventsAreIdempotent() {
        val state = StartupSurfaceState()
        state.contentPainted()
        state.contentPainted()
        state.contentUnavailable()
        state.contentUnavailable()
        assertTrue(state.visible)

        state.contentPainted()
        state.contentPainted()
        assertFalse(state.visible)
    }
}
