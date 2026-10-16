package com.wotbtools.app

import org.junit.Assert.*
import org.junit.Test

class LocalAppOriginTest {
    @Test fun localDocumentAndChunksShareTheExactLocalOrigin() {
        assertEquals("http://127.0.0.1:21653/index.html", MainActivity.LOCAL_APP_ENTRY)
        listOf("/index.html", "/index.html?view=replay", "/assets/chunk.js", "/wasm/parser.wasm").forEach {
            assertTrue(MainActivity.isLocalAppUrl(MainActivity.LOCAL_APP_ORIGIN + it))
        }
    }

    @Test fun externalAndLookalikeOriginsCannotRemainTheMainFrame() {
        listOf(
            "https://wotbtools.com", "https://www.wotbtools.com", "https://auth.wotbtools.com",
            "https://127.0.0.1:21653/index.html", "file:///index.html", "content://app/index.html",
            "http://127.0.0.1:21654/index.html", "http://127.0.0.1/index.html", "http://127.0.0.2:21653/index.html",
            "http://localhost:21653/index.html", "http://[::1]:21653/index.html",
            "http://127.0.0.1:21653.evil.example/index.html",
            "http://user@127.0.0.1:21653/index.html", "not a URI"
        ).forEach { assertFalse(it, MainActivity.isLocalAppUrl(it)) }
        assertEquals(MainActivity.LOCAL_APP_ORIGIN + "/__native/replay-pending", ReplayIntentHandler.STREAM_URL)
    }
}
