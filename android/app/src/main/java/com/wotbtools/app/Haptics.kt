package com.wotbtools.app

import android.os.Build
import android.view.HapticFeedbackConstants

/**
 * 触感映射（Native Bridge 可选能力 `haptics`）：页面只发事件种类，Native 选系统触感常量，
 * 跟随系统「触摸反馈」设置。纯函数便于单测；未知种类返回 null（不振动）。
 */
object Haptics {
    val KINDS = setOf("selection", "primary", "success", "error", "endpoint")

    fun feedbackConstant(kind: String?, sdk: Int = Build.VERSION.SDK_INT): Int? = when (kind) {
        "selection", "endpoint" -> HapticFeedbackConstants.CLOCK_TICK
        "primary" -> HapticFeedbackConstants.VIRTUAL_KEY
        "success" -> if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
        "error" -> if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
        else -> null
    }
}
