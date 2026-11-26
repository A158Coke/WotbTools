package com.wotbtools.app

import android.content.pm.ActivityInfo

/**
 * 页面方向锁与 HTML 全屏方向的纯状态机（便于 JVM 单测；Activity 只负责把结果写进 requestedOrientation）。
 *
 * 进入全屏：保存当前页面方向（如回放查看器的竖屏锁），手机上改为 SENSOR_LANDSCAPE；
 * 全屏期间页面锁只改写「待还原」值；退出全屏（按钮 / Android Back / 系统手势 同一条路径）还原保存值。
 */
class FullscreenOrientation {
    private var saved: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    var fullscreen: Boolean = false
        private set

    /** 返回要写入 requestedOrientation 的值；已在全屏则 null。 */
    fun enter(currentRequested: Int, phone: Boolean): Int? {
        if (fullscreen) return null
        fullscreen = true
        saved = currentRequested
        return if (phone) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else null
    }

    /** 返回要写入 requestedOrientation 的值；不在全屏则 null。 */
    fun exit(): Int? {
        if (!fullscreen) return null
        fullscreen = false
        return saved
    }

    /** 页面方向锁变更：全屏期间只更新待还原值（返回 null），否则返回要立即应用的值。 */
    fun setPageOrientation(orientation: Int): Int? {
        if (fullscreen) { saved = orientation; return null }
        return orientation
    }
}
