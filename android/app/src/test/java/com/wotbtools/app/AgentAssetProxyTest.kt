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

/**
 * [AgentAssetProxy] 纯函数的纯 JVM 测试（缓存键稳定性 / MIME 归一化 / LRU 淘汰选择）。
 * 网络与文件胶水刻意不在此覆盖——那部分依赖 Android framework，属于真机验收范畴。
 */
class AgentAssetProxyTest {

    @Test
    fun cacheKeyIsStableFixedLengthSha256Hex() {
        val key = AgentAssetProxy.cacheKey("/agent-assets/glb/1/model.glb")
        assertEquals(64, key.length)
        assertEquals(key, AgentAssetProxy.cacheKey("/agent-assets/glb/1/model.glb"))
        // 逻辑路径不同 → 键不同（路径是唯一身份，不得互相覆盖）
        assertNotEquals(key, AgentAssetProxy.cacheKey("/agent-assets/glb/2/model.glb"))
        assertNotEquals(AgentAssetProxy.cacheKey("/agent-assets/a"), AgentAssetProxy.cacheKey("/agent-assets/ab"))
    }

    @Test
    fun upstreamPathStripsLocalPrefixAndKeepsRootSlash() {
        // 资产包在 origin 根目录：本机路由前缀 /agent-assets 必须剥掉，且保留根路径斜杠——
        // 否则冷缓存请求会打到上游的 /agent-assets/... 而 404
        assertEquals("/index.json", AgentAssetProxy.upstreamPath("/agent-assets/index.json"))
        assertEquals("/glb/1/model.glb", AgentAssetProxy.upstreamPath("/agent-assets/glb/1/model.glb"))
        assertEquals("/", AgentAssetProxy.upstreamPath("/agent-assets/"))
        // 缓存键仍用完整本机路径（与上游 key 语义不同，不得混用）：
        // 前缀剥离只影响上游 URL，不影响缓存身份
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
        // total 120；预算 50 → 依次淘汰 lastModified 最早的 b(30)、c(30)、a(60)
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
