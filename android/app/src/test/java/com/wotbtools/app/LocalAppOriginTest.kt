package com.wotbtools.app

import org.junit.Assert.*
import org.junit.Test

class LocalAppOriginTest {
    @Test fun localDocumentAndChunksShareTheExactHttpsOrigin() {
        assertEquals("https://appassets.androidplatform.net/index.html", MainActivity.LOCAL_APP_ENTRY)
        listOf("/index.html", "/index.html?view=replay", "/assets/chunk.js", "/wasm/parser.wasm").forEach {
            assertTrue(MainActivity.isLocalAppUrl(MainActivity.LOCAL_APP_ORIGIN + it))
        }
    }

    @Test fun externalAndLookalikeOriginsCannotRemainTheMainFrame() {
        listOf(
            "https://wotbtools.com", "https://www.wotbtools.com", "https://auth.wotbtools.com",
            "http://appassets.androidplatform.net/index.html", "file:///index.html", "content://app/index.html",
            "https://appassets.androidplatform.net.evil.example/index.html",
            "https://appassets.androidplatform.net.:443/index.html",
            "https://appassets.androidplatform.net:443/index.html",
            "https://user@appassets.androidplatform.net/index.html", "not a URI"
        ).forEach { assertFalse(it, MainActivity.isLocalAppUrl(it)) }
        assertEquals(setOf(MainActivity.LOCAL_APP_ORIGIN, "https://wotbtools.com", "https://www.wotbtools.com"),
            MainActivity.BRIDGE_ORIGINS)
        assertEquals(MainActivity.LOCAL_APP_ORIGIN + "/__native/replay-pending", ReplayIntentHandler.STREAM_URL)
    }
}
