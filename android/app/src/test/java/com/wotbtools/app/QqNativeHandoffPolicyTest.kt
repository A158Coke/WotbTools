package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * QQ native handoff 改写决策的 JVM 回归测试。
 *
 * 这些用例同时是**安全契约**：在没有真机 URI 形状证据前，生产路径一律 `DO_NOT_REWRITE`（沿用 QQ 原
 * URI）；只有 `recognizedShape = true`（PR B 拿到证据后）才允许改写。
 */
class QqNativeHandoffPolicyTest {

    private fun plan(
        inAuthFlow: Boolean = true,
        scheme: String? = "wtloginmqq",
        host: String? = "ptlogin",
        hasSchemaCallback: Boolean = true,
        schemaCallbackScheme: String? = "https",
        recognizedShape: Boolean = true
    ): QqHandoffPlan = QqNativeHandoffPolicy.plan(
        inAuthFlow = inAuthFlow,
        scheme = scheme,
        host = host,
        hasSchemaCallback = hasSchemaCallback,
        schemaCallbackScheme = schemaCallbackScheme,
        recognizedShape = recognizedShape
    )

    @Test
    fun recognizedShapeInsideAuthFlowAllowsRewrite() {
        val decision = plan()
        assertEquals(QqHandoffRewrite.REWRITE_ALLOWED, decision.rewrite)
        assertEquals("recognized", decision.reason)
        assertTrue(decision.hasSchemaCallback)
    }

    @Test
    fun productionDefaultKeepsRewriteOffWithoutDeviceEvidence() {
        // 生产调用点不传 recognizedShape ⇒ 取 QqNativeHandoffPolicy.RECOGNIZED_SHAPE_EVIDENCE（= false）。
        // 这是 PR A 的核心安全立场：QQ 私有 contract 不猜测，handoff 仍走原 URI。
        val decision = QqNativeHandoffPolicy.plan(
            inAuthFlow = true,
            scheme = "wtloginmqq",
            host = "ptlogin",
            hasSchemaCallback = true,
            schemaCallbackScheme = "https"
        )
        assertEquals(QqHandoffRewrite.DO_NOT_REWRITE, decision.rewrite)
        assertEquals("unsupported-shape", decision.reason)
    }

    @Test
    fun wrongSchemeOrHostIsNeverRewritten() {
        assertEquals("wrong-scheme", plan(scheme = "wtloginmqq2", recognizedShape = true).reason)
        assertEquals("wrong-scheme", plan(scheme = "https", host = "ptlogin").reason)
        assertEquals("wrong-host", plan(host = "sub.ptlogin").reason)
        assertEquals("wrong-host", plan(host = "ptlogin.qq.com").reason)
        assertEquals("wrong-host", plan(host = null).reason)
        assertEquals("wrong-scheme", plan(scheme = null, host = "ptlogin").reason)
    }

    @Test
    fun outsideAuthFlowIsNeverRewritten() {
        val decision = plan(inAuthFlow = false)
        assertEquals(QqHandoffRewrite.DO_NOT_REWRITE, decision.rewrite)
        assertEquals("outside-auth-flow", decision.reason)
    }

    @Test
    fun missingSchemaCallbackIsNeverRewritten() {
        val decision = plan(hasSchemaCallback = false, schemaCallbackScheme = null)
        assertEquals(QqHandoffRewrite.DO_NOT_REWRITE, decision.rewrite)
        assertEquals("no-schema-callback", decision.reason)
        assertFalse(decision.hasSchemaCallback)
    }

    @Test
    fun unknownShapeIsNeverRewritten() {
        val decision = plan(recognizedShape = false)
        assertEquals(QqHandoffRewrite.DO_NOT_REWRITE, decision.rewrite)
        assertEquals("unsupported-shape", decision.reason)
    }

    @Test
    fun exactTargetIsAcceptanceCaseInsensitivelyAndMatchesNavigationPolicy() {
        // 信任边界只有一份：AuthNavigationPolicy.NATIVE_AUTH_TARGETS。大小写 / 尾部点与它保持一致。
        assertEquals(QqHandoffRewrite.REWRITE_ALLOWED, plan(scheme = "WTLOGINMQQ", host = "PTLOGIN").rewrite)
        assertEquals(QqHandoffRewrite.REWRITE_ALLOWED, plan(host = "ptlogin.").rewrite)
    }

    @Test
    fun schemaCallbackValueIsOnlyClassifiedNeverReturned() {
        assertEquals(QqCallbackCategory.BROWSER, plan(schemaCallbackScheme = "https").callbackCategory)
        assertEquals(QqCallbackCategory.BROWSER, plan(schemaCallbackScheme = "HTTP").callbackCategory)
        assertEquals(QqCallbackCategory.APP, plan(schemaCallbackScheme = "wotbtools").callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = "mqqapi").callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = null).callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = "").callbackCategory)
    }

    @Test
    fun everyReasonTokenIsSafeAndStable() {
        // reason 是日志 token 白名单：只允许这几个值，绝不携带 URI / query / value。
        val reasons = listOf(
            plan().reason,
            QqNativeHandoffPolicy.plan(true, "wtloginmqq", "ptlogin", true, "https", false).reason,
            plan(inAuthFlow = false).reason,
            plan(scheme = "evil").reason,
            plan(host = "evil").reason,
            plan(hasSchemaCallback = false).reason
        )
        assertEquals(setOf("recognized", "unsupported-shape", "outside-auth-flow", "wrong-scheme", "wrong-host", "no-schema-callback"), reasons.toSet())
    }
}

/**
 * DEBUG-only 取证输出的 JVM 回归测试：只允许出现 path 与 query **key 名**，不可能包含任何 value
 * （[describeQqHandoffShape] 的签名里根本没有 value 参数）。
 */
class QqHandoffShapeDiagnosticsTest {

    @Test
    fun keysAreSortedDeduplicatedAndBlankFiltered() {
        assertEquals(
            "path=/main keys=[a,schemacallback] schemacallback=true",
            describeQqHandoffShape("/main", listOf("schemacallback", "a", "a", " "), hasSchemaCallback = true)
        )
    }

    @Test
    fun missingPathAndEmptyKeysAreRenderedAsPlaceholders() {
        assertEquals(
            "path=- keys=[] schemacallback=false",
            describeQqHandoffShape(null, emptyList(), hasSchemaCallback = false)
        )
        assertEquals(
            "path=- keys=[] schemacallback=false",
            describeQqHandoffShape("", emptyList(), hasSchemaCallback = false)
        )
    }
}
