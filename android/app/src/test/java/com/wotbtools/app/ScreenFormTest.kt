package com.wotbtools.app

import android.content.pm.ActivityInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun pageLockMapsToSensorLandscapeAndReleaseToUnspecified() {
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, ScreenForm.pageOrientation(true))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, ScreenForm.pageOrientation(false))
    }
}
