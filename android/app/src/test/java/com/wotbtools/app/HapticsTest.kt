package com.wotbtools.app

import android.os.Build
import android.view.HapticFeedbackConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HapticsTest {
    @Test
    fun everyContractKindMapsToASystemConstant() {
        for (kind in Haptics.KINDS) {
            assert(Haptics.feedbackConstant(kind, Build.VERSION_CODES.R) != null) { kind }
        }
    }

    @Test
    fun confirmAndRejectFallBackBeforeApi30() {
        assertEquals(HapticFeedbackConstants.CONFIRM, Haptics.feedbackConstant("success", Build.VERSION_CODES.R))
        assertEquals(HapticFeedbackConstants.VIRTUAL_KEY, Haptics.feedbackConstant("success", Build.VERSION_CODES.Q))
        assertEquals(HapticFeedbackConstants.REJECT, Haptics.feedbackConstant("error", Build.VERSION_CODES.R))
        assertEquals(HapticFeedbackConstants.LONG_PRESS, Haptics.feedbackConstant("error", Build.VERSION_CODES.Q))
    }

    @Test
    fun unknownKindDoesNotVibrate() {
        assertNull(Haptics.feedbackConstant("explode"))
        assertNull(Haptics.feedbackConstant(null))
    }
}
