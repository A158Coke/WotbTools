package com.wotbtools.app

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLStreamHandler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

class AgentAssetProxyTest {

    @Test
    fun cacheKeyIsStableFixedLengthSha256Hex() {
        val key = AgentAssetProxy.cacheKey("/agent-assets/glb/1/model.glb")
        assertEquals(64, key.length)
        assertEquals(key, AgentAssetProxy.cacheKey("/agent-assets/glb/1/model.glb"))
        assertNotEquals(key, AgentAssetProxy.cacheKey("/agent-assets/glb/2/model.glb"))
        assertNotEquals(AgentAssetProxy.cacheKey("/agent-assets/a"), AgentAssetProxy.cacheKey("/agent-assets/ab"))
    }

    @Test
    fun upstreamPathStripsLocalPrefixAndKeepsRootSlash() {
        assertEquals("/index.json", AgentAssetProxy.upstreamPath("/agent-assets/index.json"))
        assertEquals("/glb/1/model.glb", AgentAssetProxy.upstreamPath("/agent-assets/glb/1/model.glb"))
        assertEquals("/", AgentAssetProxy.upstreamPath("/agent-assets/"))
        assertNotEquals(
            AgentAssetProxy.upstreamPath("/agent-assets/index.json"),
            AgentAssetProxy.cacheKey("/agent-assets/index.json")
        )
    }

    @Test
    fun upstreamUrlUsesProductionAlibabaOrigin() {
        assertEquals("https://assets.wotbtools.com/index.json", AgentAssetProxy.upstreamUrl("/agent-assets/index.json"))
    }


    @Test
    fun contentTypeDropsCharsetParamsAndFallsBackToOctetStream() {
        assertEquals("application/json", AgentAssetProxy.normalizeContentType("application/json; charset=utf-8"))
        assertEquals("binary/octet-stream", AgentAssetProxy.normalizeContentType("Binary/Octet-Stream"))
        assertEquals("application/octet-stream", AgentAssetProxy.normalizeContentType(null))
        assertEquals("application/octet-stream", AgentAssetProxy.normalizeContentType(""))
        assertEquals("application/octet-stream", AgentAssetProxy.normalizeContentType("; charset=utf-8"))
    }

    @Test
    fun trimSelectionDropsOldestFirstUntilWithinBudget() {
        val entries = listOf(
            Triple("a.body", 60L, 3L),
            Triple("b.body", 30L, 1L),
            Triple("c.body", 30L, 2L),
        )
        assertEquals(listOf("b.body", "c.body", "a.body"), AgentAssetProxy.trimSelection(entries, 50))
    }

    @Test
    fun trimSelectionKeepsEverythingWithinBudget() {
        val entries = listOf(
            Triple("a.body", 60L, 3L),
            Triple("b.body", 30L, 1L),
        )
        assertEquals(emptyList<String>(), AgentAssetProxy.trimSelection(entries, 90))
        assertEquals(emptyList<String>(), AgentAssetProxy.trimSelection(entries, 1000))
        assertEquals(emptyList<String>(), AgentAssetProxy.trimSelection(emptyList(), 1))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class AgentAssetProxyStatusTest {
    private fun request(path: String, status: Int): ReplayIntentHandler.StreamResponse {
        val origin = URL(null, "https://assets.example.test", object : URLStreamHandler() {
            override fun openConnection(url: URL) = object : HttpURLConnection(url) {
                override fun connect() = Unit
                override fun disconnect() = Unit
                override fun usingProxy() = false
                override fun getResponseCode() = status
                override fun getInputStream() = "cached data".byteInputStream()
                override fun getContentType() = "application/json"
            }
        })
        return AgentAssetProxy.intercept(RuntimeEnvironment.getApplication(), path, origin)
    }

    @Test
    fun deletedDatasetStampReturnsOriginStatusWithOrWithoutCachedCopy() {
        for (status in listOf(404, 410)) {
            val path = "/agent-assets/v/retired-$status/version.json"
            assertEquals(status, request(path, status).status)
            request(path, 200).data!!.close()
            assertEquals(status, request(path, status).status)
            assertEquals(502, request(path, 503).status)
        }
    }

    @Test
    fun transientStampErrorsAndMissingOrdinaryAssetsStillUseStaleCache() {
        val stamp = "/agent-assets/v/active/version.json"
        assertEquals(502, request(stamp, 503).status)
        request(stamp, 200).data!!.close()
        assertEquals("cached data", request(stamp, 503).data!!.bufferedReader().use { it.readText() })
        val icon = "/agent-assets/v/active/tank_images/1.webp"
        request(icon, 200).data!!.close()
        assertEquals("cached data", request(icon, 404).data!!.bufferedReader().use { it.readText() })
    }
}
