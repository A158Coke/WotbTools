package com.wotbtools.app

import android.content.pm.ActivityInfo

/**
 * 屏幕形态判定（Native Bridge 可选能力 `screen-form`）：只有手机上的 App 在场景页
 * （2D / 3D 回放、装甲查看器、射击复现、地图 3D）强制横屏；平板不锁方向。
 * 纯函数，便于单测；Activity 只负责读取 Configuration 与写 requestedOrientation。
 */
object ScreenForm {
    /** Android 惯例：最小宽度 < 600dp 视为手机（sw600dp 起是平板）。 */
    const val PHONE_MAX_SMALLEST_WIDTH_DP = 600

    fun isPhone(smallestScreenWidthDp: Int): Boolean =
        smallestScreenWidthDp in 1 until PHONE_MAX_SMALLEST_WIDTH_DP

    /** 页面方向锁对应的 requestedOrientation：锁定 = 随传感器在两个横向之间切换，释放 = 不指定。 */
    fun pageOrientation(locked: Boolean): Int =
        if (locked) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
}
