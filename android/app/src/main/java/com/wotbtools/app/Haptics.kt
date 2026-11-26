package com.wotbtools.app

import android.os.Build
import android.view.HapticFeedbackConstants

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
