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
        // PR A 不冻结任何 app-owned return scheme：custom scheme 一律 UNKNOWN（含 "wotbtools"）。
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = "wotbtools").callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = "wtloginmqq").callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = "mqqapi").callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = null).callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = "").callbackCategory)
        assertEquals(QqCallbackCategory.UNKNOWN, plan(schemaCallbackScheme = "   ").callbackCategory)
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
 * DEBUG-only 取证输出的 JVM 回归测试。
 *
 * 契约：只允许出现**结构**（path 是否存在、path segment 数量、query **key 名**、`schemacallback`
 * 是否存在）。`describeQqHandoffShape` 的签名里既没有 raw path、也没有任何 value，因此 raw path /
 * path segment 内容 / query value 在物理上无法进入输出。
 */
class QqHandoffShapeDiagnosticsTest {

    /** 模拟敏感 path：count 之外的任何内容都不允许出现在输出里。 */
    private val sensitivePath = "/secret-session-token/abc123"

    @Test
    fun structureOnlyForPathsAndKeys() {
        assertEquals(
            "pathPresent=true pathSegmentCount=2 keys=[a,schemacallback] schemacallback=true",
            describeQqHandoffShape(
                pathPresent = true,
                pathSegmentCount = 2,
                queryNames = listOf("schemacallback", "a", "a", " "),
                hasSchemaCallback = true
            )
        )
    }

    @Test
    fun missingPathIsReportedWithoutContent() {
        assertEquals(
            "pathPresent=false pathSegmentCount=0 keys=[] schemacallback=false",
            describeQqHandoffShape(
                pathPresent = false,
                pathSegmentCount = 0,
                queryNames = emptyList(),
                hasSchemaCallback = false
            )
        )
        // 防御：即使调用方误传了 count，pathPresent=false 时也不得输出计数（没有 path 就没有 segment）。
        assertEquals(
            "pathPresent=false pathSegmentCount=0 keys=[] schemacallback=false",
            describeQqHandoffShape(
                pathPresent = false,
                pathSegmentCount = 7,
                queryNames = emptyList(),
                hasSchemaCallback = false
            )
        )
    }

    @Test
    fun singleSegmentPathReportsCountOnly() {
        val output = describeQqHandoffShape(
            pathPresent = true,
            pathSegmentCount = 1,
            queryNames = emptyList(),
            hasSchemaCallback = false
        )
        assertEquals("pathPresent=true pathSegmentCount=1 keys=[] schemacallback=false", output)
        assertFalse(output.contains("foo"))
    }

    @Test
    fun sensitivePathContentNeverLeaks() {
        // 真机取证时调用方只会传 pathSegments.size —— 这里模拟同样的输入，断言三个敏感 token 都不出现。
        val output = describeQqHandoffShape(
            pathPresent = true,
            pathSegmentCount = sensitivePath.trim('/').split('/').size,
            queryNames = listOf("p", "schemacallback", "state", "code", "ticket", "token"),
            hasSchemaCallback = true
        )
        assertEquals(
            "pathPresent=true pathSegmentCount=2 keys=[code,p,schemacallback,state,ticket,token] schemacallback=true",
            output
        )
        listOf("secret", "session", "abc123", sensitivePath).forEach { forbidden ->
            assertFalse("output must not contain '$forbidden': $output", output.contains(forbidden))
        }
    }

    @Test
    fun keysAreSortedDeduplicatedAndBlankFiltered() {
        val output = describeQqHandoffShape(
            pathPresent = true,
            pathSegmentCount = 1,
            queryNames = listOf(" z ", "a", "a", "", "   ", "b"),
            hasSchemaCallback = false
        )
        assertEquals("pathPresent=true pathSegmentCount=1 keys=[a,b,z] schemacallback=false", output)
    }

    @Test
    fun keyNamesKeepTheirOriginalCase() {
        // 取证要还原 QQ 的真实 key 名，因此刻意不做大小写折叠（排序按 ordinal）。
        val output = describeQqHandoffShape(true, 1, listOf("B", "a"), hasSchemaCallback = false)
        assertEquals("pathPresent=true pathSegmentCount=1 keys=[B,a] schemacallback=false", output)
    }

    @Test
    fun schemaCallbackIsPresenceOnly() {
        assertTrue(
            describeQqHandoffShape(true, 1, emptyList(), hasSchemaCallback = true).endsWith("schemacallback=true")
        )
        assertTrue(
            describeQqHandoffShape(true, 1, emptyList(), hasSchemaCallback = false).endsWith("schemacallback=false")
        )
    }
}
