package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [AuthResult] 的纯 JVM 测试：失败原因到 wire `error` 的投影是契约的一部分
 * （`error ∈ null | unauthenticated | refresh-failed`），必须逐项固定。
 */
class AuthResultTest {

    @Test
    fun successCarriesTheSessionAndHasNoWireError() {
        val session = AuthSession.unauthenticated()
        val result = AuthResult.Success(session)
        assertEquals(session, result.session)
    }

    @Test
    fun onlyRefreshFailureMapsToRefreshFailed() {
        assertEquals(
            "refresh-failed",
            AuthResult.Failure(AuthFailureReason.REFRESH_FAILED).wireError
        )
        listOf(
            AuthFailureReason.STATE_MISMATCH,
            AuthFailureReason.REDIRECT_MISMATCH,
            AuthFailureReason.MISSING_CODE,
            AuthFailureReason.CANCELLED,
            AuthFailureReason.PROVIDER_ERROR,
            AuthFailureReason.EXCHANGE_FAILED,
            AuthFailureReason.UNAUTHENTICATED,
            AuthFailureReason.CORRUPTED_STATE,
            AuthFailureReason.UNSUPPORTED
        ).forEach { reason ->
            assertEquals("reason=$reason", "unauthenticated", AuthResult.Failure(reason).wireError)
        }
    }

    @Test
    fun logTokenIsTheSnakeCaseReasonAndCarriesNoPayload() {
        // 日志 token 只由封闭枚举派生：不可能把 token / code / URI 混进日志。
        assertEquals("redirect_mismatch", AuthResult.Failure(AuthFailureReason.REDIRECT_MISMATCH).logToken)
        assertEquals("cancelled", AuthResult.Failure(AuthFailureReason.CANCELLED).logToken)
        assertEquals("refresh_failed", AuthResult.Failure(AuthFailureReason.REFRESH_FAILED).logToken)
    }

    @Test
    fun everyReasonIsCoveredByTheClosedSet() {
        // 固定封闭集合：新增原因必须显式改这里（防止悄悄扩大 wire 语义）。
        assertEquals(
            setOf(
                "STATE_MISMATCH",
                "REDIRECT_MISMATCH",
                "MISSING_CODE",
                "CANCELLED",
                "PROVIDER_ERROR",
                "EXCHANGE_FAILED",
                "UNAUTHENTICATED",
                "REFRESH_FAILED",
                "CORRUPTED_STATE",
                "UNSUPPORTED"
            ),
            AuthFailureReason.values().map { it.name }.toSet()
        )
    }
}
