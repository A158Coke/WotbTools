package com.wotbtools.app

import org.junit.Assert.assertTrue
import org.junit.Test

class GeckoRuntimeConfigTest {
    @Test
    fun disablesTrustedOnlyFullscreenRequestsAndNothingElse() {
        val yaml = GeckoRuntimeConfig.yaml()
        assertTrue(yaml.startsWith("prefs:\n"))
        assertTrue(yaml.contains("  full-screen-api.allow-trusted-requests-only: false\n"))
        assertTrue(yaml.lines().filter { it.startsWith("  ") }.size == 1)
    }
}
