package com.wotbtools.app

import android.content.pm.ActivityInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenFormTest {
    @Test
    fun phonesAreBelowSw600() {
        assertTrue(ScreenForm.isPhone(360))
        assertTrue(ScreenForm.isPhone(411))
        assertTrue(ScreenForm.isPhone(599))
    }

    @Test
    fun tabletsAndUnknownConfigurationsAreNotPhones() {
        assertFalse(ScreenForm.isPhone(600))
        assertFalse(ScreenForm.isPhone(800))
        // Configuration.SMALLEST_SCREEN_WIDTH_DP_UNDEFINED == 0：未知时不锁方向
        assertFalse(ScreenForm.isPhone(0))
    }

    @Test
    fun pageLockMapsLandscapePortraitAndRelease() {
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, ScreenForm.pageOrientation("landscape"))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, ScreenForm.pageOrientation("portrait"))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, ScreenForm.pageOrientation("unspecified"))
    }

    @Test
    fun unknownOrientationModeIsRejected() {
        assertNull(ScreenForm.pageOrientation(""))
        assertNull(ScreenForm.pageOrientation(null))
        assertNull(ScreenForm.pageOrientation("sensor"))
    }
}
