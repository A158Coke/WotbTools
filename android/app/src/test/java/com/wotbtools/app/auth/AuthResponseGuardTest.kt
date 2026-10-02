package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [AuthResponseGuard] 的纯 JVM 测试 —— 「我方拥有的检查」矩阵。
 *
 * state **匹配**刻意不在这里测：那是 AppAuth `AuthorizationManagementActivity` 的职责
 * （不匹配的响应根本不会以 [AuthResponseGuard] 的形状到达），本测试只固定我们自己的三条规则：
 * redirect 归属 / code 存在性 / 错误分类。
 */
class AuthResponseGuardTest {

    private val expectedRedirect = OidcConfiguration.HTTPS_REDIRECT_URI
    private val privateRedirect = OidcConfiguration.PRIVATE_REDIRECT_URI

    @Test
    fun successfulResponsePassesTheGuard() {
        assertNull(
            AuthResponseGuard.verify(
                expectedState = "state-1",
                expectedRedirectUri = expectedRedirect,
                responseRedirectUri = expectedRedirect,
                code = "the-code",
                error = null
            )
        )
        assertNull(
            AuthResponseGuard.verify(
                expectedState = "state-1",
                expectedRedirectUri = privateRedirect,
                responseRedirectUri = privateRedirect,
                code = "the-code",
                error = null
            )
        )
    }

    @Test
    fun wrongRedirectUriIsRejectedFailClosed() {
        // 本次交易用的是 private scheme，响应却落在 HTTPS 回程：不是同一份配置，拒绝。
        val failure = AuthResponseGuard.verify(
            expectedState = "state-1",
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
            expectedRedirectUri = expectedRedirect,
            responseRedirectUri = expectedRedirect,
            code = "the-code",
            error = null
        )
        assertEquals(AuthFailureReason.UNSUPPORTED, failure?.reason)
    }
}
