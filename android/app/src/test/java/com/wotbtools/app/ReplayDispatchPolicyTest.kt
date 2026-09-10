package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [ReplayDispatchPolicy] 的纯 JVM 测试：分发决策不得依赖 Android framework 类型，
 * 因此「是否分发 / 怎么分发」可以在 testDebugUnitTest 下完整覆盖（无需 Robolectric）。
 */
class ReplayDispatchPolicyTest {

    @Test
    fun pendingReplayInNonAuthFlowNavigatesToReplayView() {
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = false,
            webViewVisible = true,
            currentUrl = "https://wotbtools.com",
            expected = ReplayDispatchAction.NAVIGATE_REPLAY
        )
        // 冷启动后 URL 仍为空（webView.url == null）：同样切到 replay canonical view。
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = false,
            webViewVisible = true,
            currentUrl = null,
            expected = ReplayDispatchAction.NAVIGATE_REPLAY
        )
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = false,
            webViewVisible = true,
            currentUrl = "",
            expected = ReplayDispatchAction.NAVIGATE_REPLAY
        )
    }

    @Test
    fun pendingReplayOnReplayWorkspaceNotifiesWebWithoutReloading() {
        // 已在 replay workspace：走 window.wotbtoolsOnReplay()，绝不 reload（否则丢掉 Web 侧已有状态）。
        listOf(
            "https://wotbtools.com/?view=replay",
            "https://wotbtools.com/?view=replay&tab=data",
            "https://www.wotbtools.com/?view=replay"
        ).forEach { url ->
            assertDispatch(
                hasPendingReplay = true,
                inAuthFlow = false,
                webViewVisible = true,
                currentUrl = url,
                expected = ReplayDispatchAction.NOTIFY_WEB
            )
        }
    }

    @Test
    fun invisibleWebViewContainerNeverDispatches() {
        // WebView 容器被门禁 / 错误 / 更新页接管时，既不导航也不 JS 回调。
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = false,
            webViewVisible = false,
            currentUrl = "https://wotbtools.com",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = false,
            webViewVisible = false,
            currentUrl = "https://wotbtools.com/?view=replay",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun noPendingReplayNeverDispatches() {
        assertDispatch(
            hasPendingReplay = false,
            inAuthFlow = false,
            webViewVisible = true,
            currentUrl = "https://wotbtools.com",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = false,
            inAuthFlow = false,
            webViewVisible = true,
            currentUrl = "https://wotbtools.com/?view=replay",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun replayIntentDuringAuthFlowIsDeferredNeverDispatched() {
        // RC5 navigation ownership：inAuthFlow=true 时 replay 只入队 —— 既不 loadUrl 也不
        // evaluateJavascript，且与「是否已在 replay view」「容器是否可见」无关。
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = true,
            webViewVisible = true,
            currentUrl = "https://wotbtools.com",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = true,
            webViewVisible = true,
            currentUrl = "https://wotbtools.com/?view=replay",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = true,
            webViewVisible = true,
            currentUrl = "https://auth.wotbtools.com",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = true,
            webViewVisible = true,
            currentUrl = null,
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = true,
            webViewVisible = false,
            currentUrl = "https://wotbtools.com",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun verifiedAuthReturnOwnsNavigationAndReplayNeverDispatches() {
        // 验收点「auth return 优先于 replay」：onNewIntent 的「先 auth 后 replay」顺序本身写在 MainActivity
        // （handleAuthReturnHot 命中即 return，JVM 无 Robolectric 无法测该顺序），所以这里用现有纯策略表达
        // 同一语义：
        //   1. verified auth return 一定把 auth transaction 置为进行中（cold/hot 都置 inAuthFlow=true）；
        //   2. inAuthFlow=true 时 decide() 恒为 NONE。
        // 因此 auth return 到达的 intent 绝不触发 replay 导航，紧随其后的 replay intent 也只能入队 —— 既不会
        // 打断 / 绕过认证，也不会被认证流程丢进第二套导航来源。
        assertTrue(
            AuthReturnPolicy.isVerifiedBrokerReturn(
                scheme = "https",
                host = "auth.wotbtools.com",
                path = "/realms/wotbtools/broker/juhe-qq/endpoint",
                type = "qq",
                hasState = true,
                hasCode = true
            )
        )
        val authTransaction = AuthNavigationPolicy.decide("https", "auth.wotbtools.com", inAuthFlow = false)
        assertEquals(AuthNavigationAction.ALLOW_AUTH_WEBVIEW, authTransaction.action)
        assertEquals(true, authTransaction.inAuthFlow)

        assertDispatch(
            hasPendingReplay = true,
            inAuthFlow = authTransaction.inAuthFlow,
            webViewVisible = true,
            currentUrl = "https://wotbtools.com",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun replayMarkerIsSharedWithTheNavigationTarget() {
        // MainActivity.REPLAY_URL = BASE_URL + "?" + REPLAY_VIEW_MARKER：分发判断的 URL 与导航目标
        // 不允许漂移，因此固定这个常量值。
        assertEquals("view=replay", ReplayDispatchPolicy.REPLAY_VIEW_MARKER)
    }

    private fun assertDispatch(
        hasPendingReplay: Boolean,
        inAuthFlow: Boolean,
        webViewVisible: Boolean,
        currentUrl: String?,
        expected: ReplayDispatchAction
    ) {
        assertEquals(
            expected,
            ReplayDispatchPolicy.decide(
                hasPendingReplay = hasPendingReplay,
                inAuthFlow = inAuthFlow,
                webViewVisible = webViewVisible,
                currentUrl = currentUrl
            )
        )
    }
}
