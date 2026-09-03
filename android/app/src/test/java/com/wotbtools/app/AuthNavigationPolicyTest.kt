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
    fun authFlowUnknownHostDoesNotOpenExternalNorClearState() {
        // 核心修复：auth flow 内遇未验证 host，不再 OPEN_EXTERNAL + 清空 inAuthFlow，
        // 而是 AUTH_FAILURE 并保留 inAuthFlow，交由 recovery 处理。
        assertDecision(
            host = "unknown.example.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
    }

    @Test
    fun unverifiedQqHostsAreNotTrusted() {
        // 未验证 QQ host 在 auth flow 内被阻断（AUTH_FAILURE），不是放行也不是 external。
        assertDecision(
            host = "ssl.ptlogin2.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        assertDecision(
            host = "malicious.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        // 非 auth flow 下未验证 QQ host 仍是普通外链。
        assertDecision(
            host = "ssl.ptlogin2.qq.com",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
    }

    @Test
    fun noWildcardQqHostsTrusted() {
        // 只信精确 graph.qq.com；同类子域不因“像 QQ”而进入 allowlist。
        assertDecision(
            host = "sub.graph.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        assertDecision(
            host = "qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
    }

    @Test
    fun ordinaryExternalHostsOpenOutsideWebView() {
        // 非 auth flow：普通未知外链继续 OPEN_EXTERNAL。
        assertDecision(
            host = "github.com",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
        assertDecision(
            host = "example.com",
            inAuthFlow = false,
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
    fun authFailureRecoveryStateTransition() {
        // 建模一次失败的 auth 交易再到恢复：unknown host 触发 AUTH_FAILURE 且保留 inAuthFlow，
        // recovery 回到 app host 后退出 auth flow（inAuthFlow=false）。
        var inAuthFlow = AuthNavigationPolicy.decide("auth.wotbtools.com", false).inAuthFlow
        assertEquals(true, inAuthFlow)

        inAuthFlow = AuthNavigationPolicy.decide("graph.qq.com", inAuthFlow).inAuthFlow
        assertEquals(true, inAuthFlow)

        val failure = AuthNavigationPolicy.decide("unknown.example.com", inAuthFlow)
        assertEquals(AuthNavigationAction.AUTH_FAILURE, failure.action)
        assertEquals(true, failure.inAuthFlow) // 不清零，交由 recovery

        // recovery 完成后回到 app host 结束 auth flow。
        val recovered = AuthNavigationPolicy.decide("wotbtools.com", failure.inAuthFlow)
        assertEquals(AuthNavigationAction.ALLOW_WEBVIEW, recovered.action)
        assertEquals(false, recovered.inAuthFlow)
    }

    @Test
    fun hostNormalizationDoesNotCreateASecondTrustBoundary() {
        assertDecision(
            host = " GRAPH.QQ.COM. ",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
    }

    @Test
    fun hostlessNavigationEndsAuthState() {
        val decision = AuthNavigationPolicy.decide(null, inAuthFlow = true)

        assertEquals(AuthNavigationAction.ALLOW_WEBVIEW, decision.action)
        assertEquals(false, decision.inAuthFlow)
    }

    @Test
    fun sourceCategoryClassifiesHosts() {
        assertEquals("app", AuthNavigationPolicy.sourceCategory("wotbtools.com"))
        assertEquals("app", AuthNavigationPolicy.sourceCategory("www.wotbtools.com"))
        assertEquals("keycloak", AuthNavigationPolicy.sourceCategory("auth.wotbtools.com"))
        assertEquals("auth-provider", AuthNavigationPolicy.sourceCategory("graph.qq.com"))
        assertEquals("unknown", AuthNavigationPolicy.sourceCategory("ssl.ptlogin2.qq.com"))
        assertEquals("unknown", AuthNavigationPolicy.sourceCategory(null))
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
