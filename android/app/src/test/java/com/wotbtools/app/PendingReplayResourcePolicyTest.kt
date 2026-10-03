package com.wotbtools.app

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PendingReplayResourcePolicyTest {
    @get:Rule val temp = TemporaryFolder()
    private val identity = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"

    @Test fun exactResourceWithoutPendingIsNative404() {
        val response = ReplayIntentHandler.interceptPendingResource(
            ReplayIntentHandler.STREAM_URL, null, null, identity
        )!!
        assertEquals(404, response.status)
        assertNull(response.data)
    }

    @Test fun exactResourceRejectsNonGetWithoutNetworkFallback() {
        val file = temp.newFile().apply { writeText("replay-bytes") }
        listOf("POST", "HEAD", "OPTIONS", "DELETE").forEach { method ->
            val response = ReplayIntentHandler.interceptPendingResource(
                ReplayIntentHandler.STREAM_URL, file, identity, identity, method
            )!!
            assertEquals(405, response.status)
            assertNull(response.data)
            assertTrue(file.isFile)
        }
    }

    @Test fun unrelatedUrlsAreNotTheNativeResource() {
        val rejected = listOf(
            "https://wotbtools.com/__native/replay-pending",
            "http://appassets.androidplatform.net/__native/replay-pending",
            "https://www.wotbtools.com/__native/replay-pending",
            "https://evil.com/__native/replay-pending",
            "https://appassets.androidplatform.net/__native/replay-pending/extra",
            "https://appassets.androidplatform.net/__native/other",
            "https://appassets.androidplatform.net/__native/replay-pending?id=$identity",
            "https://appassets.androidplatform.net:8443/__native/replay-pending",
            "https://appassets.androidplatform.net/__native/replay-pending#fragment",
            "https://user@appassets.androidplatform.net/__native/replay-pending"
        )
        rejected.forEach { url ->
            assertNull(url, ReplayIntentHandler.interceptPendingResource(url, null, null, identity))
        }
    }

    @Test fun missingFileIsNative404() {
        val response = ReplayIntentHandler.interceptPendingResource(
            ReplayIntentHandler.STREAM_URL, File(temp.root, "missing"), identity, identity
        )!!
        assertEquals(404, response.status)
        assertNull(response.data)
    }

    @Test fun validFileIsStreamedWithoutClearingOrDeletingIt() {
        val file = temp.newFile().apply { writeText("replay-bytes") }
        val response = ReplayIntentHandler.interceptPendingResource(
            ReplayIntentHandler.STREAM_URL, file, identity, identity
        )!!
        assertEquals(200, response.status)
        assertTrue(response.data is java.io.FileInputStream)
        assertEquals("replay-bytes", response.data!!.bufferedReader().use { it.readText() })
        assertTrue(file.isFile)
    }

    @Test fun identityMustStillMatchBeforeOpeningTheFixedResource() {
        val file = temp.newFile().apply { writeText("new replay") }
        listOf(null, "", " ", "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb").forEach { expected ->
            val response = ReplayIntentHandler.interceptPendingResource(
                ReplayIntentHandler.STREAM_URL, file, identity, expected
            )!!
            assertEquals(409, response.status)
            assertNull(response.data)
        }
    }

    @Test fun nativeReadFailureNeverFallsThroughToNetwork() {
        // Simulate a file disappearing after isFile, before inputStream opens it.
        val file = object : File(temp.root, "vanished") {
            override fun isFile() = true
        }
        val response = ReplayIntentHandler.interceptPendingResource(
            ReplayIntentHandler.STREAM_URL, file, identity, identity
        )!!
        assertEquals(500, response.status)
        assertNull(response.data)
    }
}
