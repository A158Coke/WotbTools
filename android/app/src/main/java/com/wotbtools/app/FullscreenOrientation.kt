package com.wotbtools.app

import android.content.pm.ActivityInfo

class FullscreenOrientation {
    private var saved: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    var fullscreen: Boolean = false
        private set

    fun enter(currentRequested: Int, phone: Boolean): Int? {
        if (fullscreen) return null
        fullscreen = true
        saved = currentRequested
        return if (phone) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else null
    }

    fun exit(): Int? {
        if (!fullscreen) return null
        fullscreen = false
        return saved
    }

    fun setPageOrientation(orientation: Int): Int? {
        if (fullscreen) { saved = orientation; return null }
        return orientation
    }
}
