package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Test

class AuthNavigationPolicyTest {

    @Test
    fun appHostsStayInWebViewAndEndAuthFlow() {
        assertDecision(
            scheme = "https",
            host = "wotbtools.com",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_WEBVIEW,
            nextInAuthFlow = false
        )
        assertDecision(
            scheme = "https",
            host = "WWW.WOTBTOOLS.COM.",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_WEBVIEW,
            nextInAuthFlow = false
        )
    }

    @Test
    fun keycloakStartsAndKeepsAuthFlowInWebView() {
        assertDecision(
            scheme = "https",
            host = "auth.wotbtools.com",
            inAuthFlow = false,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
    }

    @Test
    fun providerStaysInWebViewOnlyDuringAuthFlow() {
        assertDecision(
            scheme = "https",
            host = "graph.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
        assertDecision(
            scheme = "https",
            host = "graph.qq.com",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
        // xui.ptlogin2.qq.com 已被真实生产链证明（Android 1.0.8 真机 ADB）；仅 auth flow 内放行。
        assertDecision(
            scheme = "https",
            host = "xui.ptlogin2.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
        assertDecision(
            scheme = "https",
            host = "xui.ptlogin2.qq.com",
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
            scheme = "https",
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
            scheme = "https",
            host = "ssl.ptlogin2.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        assertDecision(
            scheme = "https",
            host = "malicious.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        // 非 auth flow 下未验证 QQ host 仍是普通外链。
        assertDecision(
            scheme = "https",
            host = "ssl.ptlogin2.qq.com",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
    }

    @Test
    fun noWildcardQqHostsTrusted() {
        // 只信精确 allowlist（graph.qq.com / xui.ptlogin2.qq.com）；同类子域不因“像 QQ”而进入。
        assertDecision(
            scheme = "https",
            host = "sub.graph.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        assertDecision(
            scheme = "https",
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
            scheme = "https",
            host = "github.com",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
        assertDecision(
            scheme = "https",
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
            val decision = AuthNavigationPolicy.decide("https", host, inAuthFlow)
            assertEquals(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, decision.action)
            inAuthFlow = decision.inAuthFlow
        }

        val callback = AuthNavigationPolicy.decide("https", "wotbtools.com", inAuthFlow)
        assertEquals(AuthNavigationAction.ALLOW_WEBVIEW, callback.action)
        assertEquals(false, callback.inAuthFlow)
    }

    @Test
    fun productionQqAuthChainStaysInWebViewUntilAppCallback() {
        // 真实生产链 regression（Android 1.0.8 真机 ADB 证据）：
        // Keycloak → graph.qq.com → xui.ptlogin2.qq.com → Keycloak callback → app。
        var inAuthFlow = false
        val chain = listOf(
            "auth.wotbtools.com" to AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            "graph.qq.com" to AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            "xui.ptlogin2.qq.com" to AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            "auth.wotbtools.com" to AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            "wotbtools.com" to AuthNavigationAction.ALLOW_WEBVIEW
        )
        chain.forEachIndexed { index, (host, expected) ->
            val decision = AuthNavigationPolicy.decide("https", host, inAuthFlow)
            assertEquals(expected, decision.action, "step $index ($host)")
            inAuthFlow = decision.inAuthFlow
        }
        assertEquals(false, inAuthFlow)
    }

    @Test
    fun authFailureRecoveryStateTransition() {
        // 建模一次失败的 auth 交易再到恢复：unknown host 触发 AUTH_FAILURE 且保留 inAuthFlow，
        // recovery 回到 app host 后退出 auth flow（inAuthFlow=false）。
        var inAuthFlow = AuthNavigationPolicy.decide("https", "auth.wotbtools.com", false).inAuthFlow
        assertEquals(true, inAuthFlow)

        inAuthFlow = AuthNavigationPolicy.decide("https", "graph.qq.com", inAuthFlow).inAuthFlow
        assertEquals(true, inAuthFlow)

        val failure = AuthNavigationPolicy.decide("https", "unknown.example.com", inAuthFlow)
        assertEquals(AuthNavigationAction.AUTH_FAILURE, failure.action)
        assertEquals(true, failure.inAuthFlow) // 不清零，交由 recovery

        // recovery 完成后回到 app host 结束 auth flow。
        val recovered = AuthNavigationPolicy.decide("https", "wotbtools.com", failure.inAuthFlow)
        assertEquals(AuthNavigationAction.ALLOW_WEBVIEW, recovered.action)
        assertEquals(false, recovered.inAuthFlow)
    }

    @Test
    fun verifiedNativeQqHandoffOnlyDuringAuthFlow() {
        // Case 2 — 已验证 exact native pair 在 auth flow 内：NATIVE_AUTH_HANDOFF 且保留 inAuthFlow。
        assertDecision(
            scheme = "wtloginmqq",
            host = "ptlogin",
            inAuthFlow = true,
            action = AuthNavigationAction.NATIVE_AUTH_HANDOFF,
            nextInAuthFlow = true
        )
        // Case 3 — 同一对在 auth flow 外不得获得 privileged NATIVE_AUTH_HANDOFF。
        assertDecision(
            scheme = "wtloginmqq",
            host = "ptlogin",
            inAuthFlow = false,
            action = AuthNavigationAction.OPEN_EXTERNAL,
            nextInAuthFlow = false
        )
    }

    @Test
    fun unknownNativeSchemeOrHostIsNotTrustedInAuthFlow() {
        // Case 4 — exact scheme 但 host 不对 → AUTH_FAILURE（fail closed）。
        assertDecision(
            scheme = "wtloginmqq",
            host = "evil",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        // Case 5 — host 对但 scheme 不对 → AUTH_FAILURE。
        assertDecision(
            scheme = "unknownscheme",
            host = "ptlogin",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
    }

    @Test
    fun noWildcardOrPrefixTrustForVerifiedNativeTarget() {
        // Case 6 — 不因 scheme 前缀 / host 后缀 / 相似名字而自动信任。
        assertDecision(
            scheme = "wtloginmqq2",
            host = "ptlogin",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        assertDecision(
            scheme = "foo",
            host = "ptlogin",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        assertDecision(
            scheme = "wtloginmqq",
            host = "sub.ptlogin",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
        assertDecision(
            scheme = "wtloginmqq",
            host = "ptlogin.qq.com",
            inAuthFlow = true,
            action = AuthNavigationAction.AUTH_FAILURE,
            nextInAuthFlow = true
        )
    }

    @Test
    fun productionQqChainReachesNativeHandoffBeforeAppCallback() {
        // 真实生产链（Android 1.0.9 真机 ADB 证据）到 native handoff：
        // auth.wotbtools.com → graph.qq.com → xui.ptlogin2.qq.com → wtloginmqq://ptlogin。
        var inAuthFlow = false
        val chain = listOf(
            Triple("https", "auth.wotbtools.com", AuthNavigationAction.ALLOW_AUTH_WEBVIEW),
            Triple("https", "graph.qq.com", AuthNavigationAction.ALLOW_AUTH_WEBVIEW),
            Triple("https", "xui.ptlogin2.qq.com", AuthNavigationAction.ALLOW_AUTH_WEBVIEW),
            Triple("wtloginmqq", "ptlogin", AuthNavigationAction.NATIVE_AUTH_HANDOFF)
        )
        chain.forEachIndexed { index, (scheme, host, expected) ->
            val decision = AuthNavigationPolicy.decide(scheme, host, inAuthFlow)
            assertEquals(expected, decision.action, "step $index ($scheme://$host)")
            inAuthFlow = decision.inAuthFlow
        }
        // native handoff 结束 auth flow：保留 inAuthFlow=true。
        assertEquals(true, inAuthFlow)
    }

    @Test
    fun hostNormalizationDoesNotCreateASecondTrustBoundary() {
        assertDecision(
            scheme = "https",
            host = " GRAPH.QQ.COM. ",
            inAuthFlow = true,
            action = AuthNavigationAction.ALLOW_AUTH_WEBVIEW,
            nextInAuthFlow = true
        )
        // 大小写 / 空白不应影响 native exact pair 匹配。
        assertDecision(
            scheme = " WtLoginMqq ",
            host = " PTLOGIN ",
            inAuthFlow = true,
            action = AuthNavigationAction.NATIVE_AUTH_HANDOFF,
            nextInAuthFlow = true
        )
    }

    @Test
    fun hostlessNavigationEndsAuthState() {
        val decision = AuthNavigationPolicy.decide(null, null, inAuthFlow = true)

        assertEquals(AuthNavigationAction.ALLOW_WEBVIEW, decision.action)
        assertEquals(false, decision.inAuthFlow)
    }

    @Test
    fun sourceCategoryClassifiesHosts() {
        assertEquals("app", AuthNavigationPolicy.sourceCategory("https", "wotbtools.com"))
        assertEquals("app", AuthNavigationPolicy.sourceCategory("https", "www.wotbtools.com"))
        assertEquals("keycloak", AuthNavigationPolicy.sourceCategory("https", "auth.wotbtools.com"))
        assertEquals("auth-provider", AuthNavigationPolicy.sourceCategory("https", "graph.qq.com"))
        assertEquals("auth-provider", AuthNavigationPolicy.sourceCategory("https", "xui.ptlogin2.qq.com"))
        assertEquals("auth-provider-native", AuthNavigationPolicy.sourceCategory("wtloginmqq", "ptlogin"))
        assertEquals("unknown", AuthNavigationPolicy.sourceCategory("https", "ssl.ptlogin2.qq.com"))
        assertEquals("unknown", AuthNavigationPolicy.sourceCategory("wtloginmqq", "evil"))
        assertEquals("unknown", AuthNavigationPolicy.sourceCategory("unknownscheme", "ptlogin"))
        assertEquals("unknown", AuthNavigationPolicy.sourceCategory(null, null))
    }

    private fun assertDecision(
        scheme: String?,
        host: String?,
        inAuthFlow: Boolean,
        action: AuthNavigationAction,
        nextInAuthFlow: Boolean
    ) {
        val decision = AuthNavigationPolicy.decide(scheme, host, inAuthFlow)

        assertEquals(action, decision.action)
        assertEquals(nextInAuthFlow, decision.inAuthFlow)
    }
}
