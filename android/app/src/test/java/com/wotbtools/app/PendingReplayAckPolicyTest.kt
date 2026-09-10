package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [PendingReplayAckPolicy] 的纯 JVM 测试：ACK 的 compare-and-clear 决策不得依赖 Android framework 类型，
 * 因此「这份 ACK 能不能清 pending」可以在 testDebugUnitTest 下完整覆盖（无需 Robolectric）。
 */
class PendingReplayAckPolicyTest {

    /** identity 是完整 UUID（Blocker 2）；短 id 只配做日志，绝不作为比较基准。 */
    private val pendingA = "3f2b9c1e-7d4a-4b8e-9f01-2c6d5a7e8b90"
    private val pendingB = "8a1d0f45-2e6b-4c37-9a58-7d3f1b2c4e60"

    @Test
    fun ackNamingTheCurrentPendingIsAccepted() {
        assertEquals(PendingReplayAckResult.SUCCESS, PendingReplayAckPolicy.decide(pendingA, pendingA))
    }

    @Test
    fun ackForAReplacedPendingNeverClearsTheNewerOne() {
        // Blocker 1 核心回归：Web 正在处理 A，期间新 replay B 到达并（single slot latest-wins）取代 slot，
        // A 被 server 接受后才发出的 ACK 必须 STALE —— 绝不允许清掉当前的 B。
        assertEquals(PendingReplayAckResult.STALE, PendingReplayAckPolicy.decide(pendingB, pendingA))
        assertEquals(PendingReplayAckResult.STALE, PendingReplayAckPolicy.decide(pendingA, pendingB))
    }

    @Test
    fun ackWithoutACurrentPendingIsStaleNotSuccess() {
        // pending 已被消费 / 未恢复：ACK 不得被当成「成功」而触发第二次清理。
        assertEquals(PendingReplayAckResult.STALE, PendingReplayAckPolicy.decide(null, pendingA))
    }

    @Test
    fun ackWithoutIdentityIsRejectedEvenWhenAPendingExists() {
        // 禁止无 identity ACK：缺失 / 空串 / 纯空白一律 MISSING_IDENTITY，与是否存在 current 无关。
        listOf(null, "", "   ", "\t\n").forEach { expected ->
            val label = expected?.let { "'$it'" } ?: "null"
            assertEquals(
                "expected=$label + current=A 必须 MISSING_IDENTITY",
                PendingReplayAckResult.MISSING_IDENTITY,
                PendingReplayAckPolicy.decide(pendingA, expected)
            )
            assertEquals(
                "expected=$label + current=null 必须 MISSING_IDENTITY（不得退化成 STALE/SUCCESS）",
                PendingReplayAckResult.MISSING_IDENTITY,
                PendingReplayAckPolicy.decide(null, expected)
            )
        }
    }

    @Test
    fun blankExpectedIsRejectedEvenWhenCurrentIsBlank() {
        assertEquals(PendingReplayAckResult.MISSING_IDENTITY, PendingReplayAckPolicy.decide("", ""))
        assertEquals(PendingReplayAckResult.MISSING_IDENTITY, PendingReplayAckPolicy.decide("   ", "   "))
    }

    @Test
    fun identityComparisonIsExactWithoutFuzzyMatching() {
        // 不同字符串就是另一份 pending：大小写、前后空白、截断 / 前缀都不做模糊匹配。
        listOf(
            pendingA.uppercase(),   // 大小写不同
            " $pendingA",           // 前导空白
            "$pendingA ",           // 尾随空白
            "  $pendingA  ",        // 两侧空白
            pendingA.dropLast(1),   // 少一位
            pendingA.take(8),       // 8 位 short ref 绝不是 identity
            pendingA + pendingB     // 拼接
        ).forEach { other ->
            assertEquals(
                "「$other」不得被当成「$pendingA」",
                PendingReplayAckResult.STALE,
                PendingReplayAckPolicy.decide(other, pendingA)
            )
        }
    }
}
