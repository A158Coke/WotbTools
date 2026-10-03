package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [ReplayDispatchPolicy] 的纯 JVM 测试：分发决策不得依赖 Android framework 类型，
 * 因此「是否分发 / 怎么分发」可以在 testDebugUnitTest 下完整覆盖（无需 Robolectric）。
 *
 * 认证已不在输入里（Native 拥有 auth，登录跑在 external user-agent）：决策只剩「有没有 pending /
 * 容器是否可见 / 是否已在 replay view」三件事。
 */
class ReplayDispatchPolicyTest {

    @Test
    fun pendingReplayNavigatesToReplayView() {
        assertDispatch(
            hasPendingReplay = true,
            webViewVisible = true,
            currentUrl = "https://appassets.androidplatform.net/index.html",
            expected = ReplayDispatchAction.NAVIGATE_REPLAY
        )
        // 冷启动后 URL 仍为空（webView.url == null）：同样切到 replay canonical view。
        assertDispatch(
            hasPendingReplay = true,
            webViewVisible = true,
            currentUrl = null,
            expected = ReplayDispatchAction.NAVIGATE_REPLAY
        )
        assertDispatch(
            hasPendingReplay = true,
            webViewVisible = true,
            currentUrl = "",
            expected = ReplayDispatchAction.NAVIGATE_REPLAY
        )
    }

    @Test
    fun pendingReplayOnReplayWorkspaceNotifiesWebWithoutReloading() {
        // 已在 replay workspace：走 window.wotbtoolsOnReplay()，绝不 reload（否则丢掉 Web 侧已有状态）。
        listOf(
            "https://appassets.androidplatform.net/index.html?view=replay",
            "https://appassets.androidplatform.net/index.html?view=replay&tab=data",
            "https://appassets.androidplatform.net/index.html?view=replay"
        ).forEach { url ->
            assertDispatch(
                hasPendingReplay = true,
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
            webViewVisible = false,
            currentUrl = "https://appassets.androidplatform.net/index.html",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = true,
            webViewVisible = false,
            currentUrl = "https://appassets.androidplatform.net/index.html?view=replay",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun noPendingReplayNeverDispatches() {
        assertDispatch(
            hasPendingReplay = false,
            webViewVisible = true,
            currentUrl = "https://appassets.androidplatform.net/index.html",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = false,
            webViewVisible = true,
            currentUrl = "https://appassets.androidplatform.net/index.html?view=replay",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun replayMarkerIsSharedWithTheNavigationTarget() {
        // MainActivity.REPLAY_URL = LOCAL_APP_ENTRY + "?" + REPLAY_VIEW_MARKER：分发判断的 URL 与导航目标
        // 不允许漂移，因此固定这个常量值。
        assertEquals("view=replay", ReplayDispatchPolicy.REPLAY_VIEW_MARKER)
    }

    private fun assertDispatch(
        hasPendingReplay: Boolean,
        webViewVisible: Boolean,
        currentUrl: String?,
        expected: ReplayDispatchAction
    ) {
        assertEquals(
            expected,
            ReplayDispatchPolicy.decide(
                hasPendingReplay = hasPendingReplay,
                webViewVisible = webViewVisible,
                currentUrl = currentUrl
            )
        )
    }
}
