package com.wotbtools.app

import android.content.pm.ActivityInfo

object ScreenForm {
    const val PHONE_MAX_SMALLEST_WIDTH_DP = 600

    fun isPhone(smallestScreenWidthDp: Int): Boolean =
        smallestScreenWidthDp in 1 until PHONE_MAX_SMALLEST_WIDTH_DP

    fun pageOrientation(mode: String?): Int? = when (mode) {
        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        "unspecified" -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        else -> null
    }
}
