package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [AuthResponseGuard] 的纯 JVM 测试 —— 「我方拥有的检查」矩阵。
 *
 * AppAuth 库仍拥有**它自己那一份** state 比较（响应 URI 的 state 与 intent 带回来的 request
 * 不一致 → 直接丢弃并回 `STATE_MISMATCH`）。本测试固定的是我们自己的四条规则：
 * 交易归属（响应 state == 持久化交易的 state）/ 回程归属 / code 存在性 / 错误分类。
 */
class AuthResponseGuardTest {

    private val expectedRedirect = OidcConfiguration.HTTPS_REDIRECT_URI
    private val privateRedirect = OidcConfiguration.PRIVATE_REDIRECT_URI

    @Test
    fun successfulResponsePassesTheGuard() {
        assertNull(
            AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = "state-1",
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = "the-code",
                error = null
            )
        )
        assertNull(
            AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = "state-1",
                expectedRedirectUri = privateRedirect,
                responseRedirectUri = privateRedirect,
                code = "the-code",
                error = null
            )
        )
    }

    @Test
    fun responseForAnotherTransactionIsRejected() {
        // 响应属于**另一笔**交易（或伪造）：它不是我们发起的那一次，必须 fail closed。
        listOf("state-2", "", "   ", null).forEach { responseState ->
            val failure = AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = responseState,
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = "the-code",
                error = null
            )
            assertEquals("responseState=$responseState", AuthFailureReason.STATE_MISMATCH, failure?.reason)
        }
    }

    @Test
    fun stateOwnershipIsCheckedBeforeAnythingElse() {
        // state 不匹配时即使 redirect 与 code 都「看起来对」也不放行；两者都不对时报 state，
        // 因为「不是这笔交易」是更根本的结论。
        val failure = AuthResponseGuard.verify(
            expectedState = "state-1",
            responseState = "state-9",
            expectedRedirectUri = privateRedirect,
            responseRedirectUri = expectedRedirect,
            code = null,
            error = null
        )
        assertEquals(AuthFailureReason.STATE_MISMATCH, failure?.reason)
    }

    @Test
    fun theOwnershipCheckComparesTheReturnedStateNotTheBundledRequestState() {
        // review 指出的自指风险：AppAuth 的 AuthorizationResponse 同时带 `state`（OAuth 响应真正
        // 返回的值）与 `request.state`（响应里自带的 request）。拿后者与持久化交易比较是自指恒等，
        // 等于这道独立校验不存在。
        //
        // 语义前提（模拟调用点）：bundled request.state == 持久化交易的 state，而返回的 state 不同。
        val bundledRequestState = "state-1"
        val returnedState = "state-other"

        assertEquals(
            AuthFailureReason.STATE_MISMATCH,
            AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = returnedState,
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = "the-code",
                error = null
            )?.reason
        )
        // 同一组输入若把 bundled request.state 当成 responseState（旧的错误接线），guard 会放行 ——
        // 这个对照正是「调用点必须用 response.state」的证据。
        assertNull(
            AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = bundledRequestState,
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = "the-code",
                error = null
            )
        )
    }

    @Test
    fun aMissingReturnedStateIsRejectedEvenWhenACodeIsPresent() {
        val failure = AuthResponseGuard.verify(
            expectedState = "state-1",
            responseState = null,
            expectedRedirectUri = expectedRedirect,
            responseRedirectUri = expectedRedirect,
            code = "the-code",
            error = null
        )
        assertEquals(AuthFailureReason.STATE_MISMATCH, failure?.reason)
    }

    @Test
    fun wrongRedirectUriIsRejectedFailClosed() {
        // 本次交易用的是 private scheme，响应却落在 HTTPS 回程：不是同一份配置，拒绝。
        val failure = AuthResponseGuard.verify(
            expectedState = "state-1",
            responseState = "state-1",
            expectedRedirectUri = privateRedirect,
            responseRedirectUri = expectedRedirect,
            code = "the-code",
            error = null
        )
        assertNotNull(failure)
        assertEquals(AuthFailureReason.REDIRECT_MISMATCH, failure!!.reason)
    }

    @Test
    fun unknownHostRedirectIsRejected() {
        listOf(
            "https://evil.example.com/android/oauth/callback",
            "com.wotbtools.app.evil:/oauth2redirect",
            "https://auth.wotbtools.com/android/oauth/other"
        ).forEach { hostile ->
            val failure = AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = "state-1",
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = hostile,
                code = "the-code",
                error = null
            )
            assertEquals(
                "redirect=$hostile",
                AuthFailureReason.REDIRECT_MISMATCH,
                failure?.reason
            )
        }
    }

    @Test
    fun missingResponseUriIsRejected() {
        // 拿不到响应 URI 就无法证明回程归属 → fail closed（不是「放行后再说」）。
        val failure = AuthResponseGuard.verify(
            expectedState = "state-1",
            responseState = "state-1",
            expectedRedirectUri = expectedRedirect,
            responseRedirectUri = null,
            code = "the-code",
            error = null
        )
        assertEquals(AuthFailureReason.REDIRECT_MISMATCH, failure?.reason)
    }

    @Test
    fun trailingSlashAndWhitespaceDoNotBreakTheRedirectComparison() {
        // 同一份配置的等价写法（尾部斜杠 / 首尾空白）不能被判成漂移。
        assertNull(
            AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = "state-1",
                expectedRedirectUri = "$expectedRedirect/",
                responseRedirectUri = "  $expectedRedirect  ",
                code = "the-code",
                error = null
            )
        )
    }

    @Test
    fun missingOrBlankCodeIsRejected() {
        listOf(null, "", "   ").forEach { code ->
            val failure = AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = "state-1",
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = code,
                error = null
            )
            assertEquals("code=$code", AuthFailureReason.MISSING_CODE, failure?.reason)
        }
    }

    @Test
    fun providerCancellationFamilyIsClassifiedAsCancelled() {
        listOf("access_denied", "ACCESS_DENIED", "user_cancelled", "login_required").forEach { error ->
            val failure = AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = "state-1",
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = null,
                error = error
            )
            assertEquals("error=$error", AuthFailureReason.CANCELLED, failure?.reason)
        }
    }

    @Test
    fun nonCancellationProviderErrorIsClassifiedAsProviderError() {
        listOf("invalid_request", "server_error", "temporarily_unavailable").forEach { error ->
            val failure = AuthResponseGuard.verify(
                expectedState = "state-1",
                responseState = "state-1",
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = null,
                error = error
            )
            assertEquals("error=$error", AuthFailureReason.PROVIDER_ERROR, failure?.reason)
        }
    }

    @Test
    fun providerErrorWinsOverMissingCode() {
        // 错误响应本来就没有 code：分类必须落在 provider 侧，而不是误报 missing-code。
        val failure = AuthResponseGuard.verify(
            expectedState = "state-1",
            responseState = "state-1",
            expectedRedirectUri = expectedRedirect,
            responseRedirectUri = expectedRedirect,
            code = "",
            error = "access_denied"
        )
        assertEquals(AuthFailureReason.CANCELLED, failure?.reason)
    }

    @Test
    fun missingExpectedStateIsUnsupportedNeverASuccess() {
        val failure = AuthResponseGuard.verify(
            expectedState = null,
            responseState = "state-1",
            expectedRedirectUri = expectedRedirect,
            responseRedirectUri = expectedRedirect,
            code = "the-code",
            error = null
        )
        assertEquals(AuthFailureReason.UNSUPPORTED, failure?.reason)
    }
}
