package com.wotbtools.app

import android.content.pm.ActivityInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FullscreenOrientationTest {
    private val portrait = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    private val landscape = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE

    @Test
    fun phoneEntersLandscapeAndExitRestoresViewerPortraitLock() {
        val state = FullscreenOrientation()
        assertEquals(landscape, state.enter(portrait, phone = true))
        assertTrue(state.fullscreen)
        // 退出按钮、Android Back、系统手势都经 exit()：手持横屏时也回竖屏
        assertEquals(portrait, state.exit())
        assertFalse(state.fullscreen)
    }

    @Test
    fun tabletKeepsItsOrientation() {
        val state = FullscreenOrientation()
        assertNull(state.enter(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, phone = false))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, state.exit())
    }

    @Test
    fun pageLockChangedDuringFullscreenOnlyUpdatesTheRestoreValue() {
        val state = FullscreenOrientation()
        state.enter(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, phone = true)
        assertNull(state.setPageOrientation(portrait))
        assertEquals(portrait, state.exit())
    }

    @Test
    fun releasingTheLockWhileFullscreenRestoresUnspecified() {
        val state = FullscreenOrientation()
        state.enter(portrait, phone = true)
        assertNull(state.setPageOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, state.exit())
    }

    @Test
    fun pageLockOutsideFullscreenAppliesImmediately() {
        val state = FullscreenOrientation()
        assertEquals(portrait, state.setPageOrientation(portrait))
    }

    @Test
    fun enterAndExitAreIdempotent() {
        val state = FullscreenOrientation()
        assertNull(state.exit())
        assertEquals(landscape, state.enter(portrait, phone = true))
        assertNull(state.enter(landscape, phone = true))
        assertEquals(portrait, state.exit())
        assertNull(state.exit())
    }
}
