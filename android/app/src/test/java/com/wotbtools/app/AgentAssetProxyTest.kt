package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

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
