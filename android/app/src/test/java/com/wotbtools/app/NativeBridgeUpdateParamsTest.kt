package com.wotbtools.app

import org.junit.Assert.*
import org.junit.Test

class NativeBridgeUpdateParamsTest {
    @Test fun versionIdentityAcceptsOnlyExactNonnegativeIntegerWithinAndroidRange() {
        assertEquals(3028000, NativeBridge.updateVersionCodeOf(3028000))
        assertEquals(3028000, NativeBridge.updateVersionCodeOf(3028000L))
        assertEquals(0, NativeBridge.updateVersionCodeOf(0))
        assertEquals(Int.MAX_VALUE, NativeBridge.updateVersionCodeOf(Int.MAX_VALUE.toLong()))
        for (invalid in listOf(null, -1, -1L, Int.MAX_VALUE.toLong() + 1, 3028000.0, 1.5, "3028000", true)) {
            assertNull("invalid identity: $invalid", NativeBridge.updateVersionCodeOf(invalid))
        }
    }

    @Test fun loginUiLocaleAcceptsOnlyContractLocales() {
        for (locale in listOf("zh", "en", "ru")) assertEquals(locale, NativeBridge.uiLocaleOf(locale))
        for (invalid in listOf(null, "", "ZH", "zh-CN", "de", "en ru", 1, true)) {
            assertNull("invalid ui locale: $invalid", NativeBridge.uiLocaleOf(invalid))
        }
    }
}
