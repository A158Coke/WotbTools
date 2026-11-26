package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

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
