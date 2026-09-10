package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [PendingReplayResourcePolicy] 的纯 JVM 测试（testDebugUnitTest，无需 Robolectric）。
 *
 * 冻结两个契约：
 * 1. **exact match**：只有 `https://wotbtools.com/__native/replay-pending` 命中；
 * 2. **Native ownership**：命中即由 `shouldInterceptRequest` 应答，绝不能 `return null`
 *    放行到真实 nginx/backend。
 *
 * 第 2 条在 [MainActivity] 里的实现是「`matchesUrl(...)` 为 true ⇒ 走 `servePendingReplayStream()`」，
 * 而 `servePendingReplayStream()` 的每个分支都返回 WebResourceResponse（无 pending → 404、
 * backing file 缺失 → 404、读取异常 → 500，都不是 null）。本测试保证判定侧不会把请求判成「不命中」，
 * 从而不会走进 `return null` 那条路径。
 */
class PendingReplayResourcePolicyTest {

    private val synthetic = PendingReplayResourcePolicy.SYNTHETIC_URL

    @Test
    fun syntheticUrlIsFixedAndSameOrigin() {
        assertEquals("https://wotbtools.com/__native/replay-pending", synthetic)
        // 不含 pendingId / 文件名 / 本地路径 / token / state / code 等任何可变或敏感成分。
        assertFalse(synthetic.contains("?"))
        assertFalse(synthetic.contains("content://"))
        assertFalse(synthetic.contains(".wotbreplay"))
    }

    @Test
    fun exactSyntheticUrlMatches() {
        assertTrue(PendingReplayResourcePolicy.matchesUrl(synthetic))
        // 与 shouldInterceptRequest 共用同一条判定路径；大小写按 URL 规范处理。
        assertTrue(PendingReplayResourcePolicy.matchesUrl("HTTPS://WOTBTOOLS.COM/__native/replay-pending"))
    }

    @Test
    fun componentMatchRequiresAllThreeParts() {
        assertTrue(PendingReplayResourcePolicy.matches("https", "wotbtools.com", "/__native/replay-pending"))
        assertFalse(PendingReplayResourcePolicy.matches("http", "wotbtools.com", "/__native/replay-pending"))
        assertFalse(PendingReplayResourcePolicy.matches("https", "evil.com", "/__native/replay-pending"))
        assertFalse(PendingReplayResourcePolicy.matches("https", "wotbtools.com", "/__native/other"))
        assertFalse(PendingReplayResourcePolicy.matches(null, null, null))
    }

    @Test
    fun rejectsNonSyntheticVariants() {
        // 明文 scheme 不放行。
        assertFalse(PendingReplayResourcePolicy.matchesUrl("http://wotbtools.com/__native/replay-pending"))
        // www 只是 Native Bridge 的 origin 白名单超集，不是 app canonical origin（BASE_URL）。
        assertFalse(PendingReplayResourcePolicy.matchesUrl("https://www.wotbtools.com/__native/replay-pending"))
        // 其他 host（含形似域名）不放行。
        assertFalse(PendingReplayResourcePolicy.matchesUrl("https://evil.com/__native/replay-pending"))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("https://wotbtools.com.evil.com/__native/replay-pending"))
        // path 必须完全一致：多一段 / 少一段 / 换名字都不放行。
        assertFalse(PendingReplayResourcePolicy.matchesUrl("https://wotbtools.com/__native/replay-pending/extra"))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("https://wotbtools.com/__native/other"))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("https://wotbtools.com/"))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("https://wotbtools.com/__native/replay-pendingx"))
        // 其他 scheme（包括旧的 content:// transport）不放行。
        assertFalse(PendingReplayResourcePolicy.matchesUrl("content://com.wotbtools.app.fileprovider/replay/a.wotbreplay"))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("file:///data/data/com.wotbtools.app/cache/replay/a.wotbreplay"))
    }

    @Test
    fun rejectsMalformedInput() {
        assertFalse(PendingReplayResourcePolicy.matchesUrl(null))
        assertFalse(PendingReplayResourcePolicy.matchesUrl(""))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("   "))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("not a url"))
        assertFalse(PendingReplayResourcePolicy.matchesUrl("/__native/replay-pending"))
    }

    @Test
    fun queryIsIgnoredSoTheRequestStaysNativeOwned() {
        // fail-closed：即便有人误把参数加到 synthetic URL 上，判定仍然命中 → 请求被 Native 应答，
        // 而不是漏到真实后端（放行到真实网络才会造成 pendingId / 路径泄漏）。
        assertTrue(PendingReplayResourcePolicy.matchesUrl("$synthetic?id=abc"))
    }
}
