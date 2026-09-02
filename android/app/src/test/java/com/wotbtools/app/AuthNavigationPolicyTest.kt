package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Test

class AuthNavigationPolicyTest {

    @Test
    fun appHostsStayInWebViewAndEndAuthFlow() {
        assertDecision(
            host = "wotbtools.com",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_WEBVIEW,
            nextInAuthFlow = false
        )
        assertDecision(
            host = "WWW.WOTBTOOLS.COM.",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_WEBVIEW,
            nextInAuthFlow = false
        )
    }

    @Test
    fun keycloakStartsAndKeepsAuthFlowInWebView() {
        assertDecision(
            host = "auth.wotbtools.com",
            inAuthFlow = false,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
    }

    @Test
    fun providerStaysInWebViewOnlyDuringAuthFlow() {
        assertDecision(
            host = "graph.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
        assertDecision(
            host = "graph.qq.com",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
    }

    @Test
    fun unverifiedQqHostsAreNotTrusted() {
        assertDecision(
            host = "ssl.ptlogin2.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
        assertDecision(
            host = "malicious.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
    }

    @Test
    fun ordinaryExternalHostsOpenOutsideWebView() {
        assertDecision(
            host = "github.com",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
        assertDecision(
            host = "example.com",
            inAuthFlow = true,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
    }

    @Test
    fun callbackSequenceEndsAuthFlowAtAppHost() {
        var inAuthFlow = false

        listOf("auth.wotbtools.com", "graph.qq.com", "auth.wotbtools.com").forEach { host ->
            val decision = AuthNavigationPolicy.decide(host, inAuthFlow)
            assertEquals(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, decision.action)
            inAuthFlow = decision.inAuthFlow
        }

        val callback = AuthNavigationPolicy.decide("wotbtools.com", inAuthFlow)
        assertEquals(AuthNavigationAction.ALLOW_WEBVIEW, callback.action)
        assertEquals(false, callback.inAuthFlow)
    }

    @Test
    fun hostNormalizationDoesNotCreateASecondTrustBoundary() {
        assertDecision(
            host = " GRAPH.QQ.COM. ",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
        assertDecision(
            host = "sub.graph.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
    }

    @Test
    fun hostlessNavigationEndsAuthState() {
        val decision = AuthNavigationPolicy.decide(null, inAuthFlow = true)

        assertEquals(AuthNavigationAction.ALLOW_WEBVIEW, decision.action)
        assertEquals(false, decision.inAuthFlow)
    }

    private fun assertDecision(
        host: String,
        inAuthFlow: Boolean,
        action: AuthNavigationAction,
        nextInAuthFlow: Boolean
    ) {
        val decision = AuthNavigationPolicy.decide(host, inAuthFlow)

        assertEquals(action, decision.action)
        assertEquals(nextInAuthFlow, decision.inAuthFlow)
    }
}
