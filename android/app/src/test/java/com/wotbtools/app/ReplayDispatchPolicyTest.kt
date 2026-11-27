package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Test

class ReplayDispatchPolicyTest {

    @Test
    fun pendingReplayNavigatesToReplayView() {
        assertDispatch(
            hasPendingReplay = true,
            webViewVisible = true,
            currentUrl = "http://127.0.0.1:21653/index.html",
            expected = ReplayDispatchAction.NAVIGATE_REPLAY
        )
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
        listOf(
            "http://127.0.0.1:21653/index.html?view=replay",
            "http://127.0.0.1:21653/index.html?view=replay&tab=data",
            "http://127.0.0.1:21653/index.html?view=replay"
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
        assertDispatch(
            hasPendingReplay = true,
            webViewVisible = false,
            currentUrl = "http://127.0.0.1:21653/index.html",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = true,
            webViewVisible = false,
            currentUrl = "http://127.0.0.1:21653/index.html?view=replay",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun noPendingReplayNeverDispatches() {
        assertDispatch(
            hasPendingReplay = false,
            webViewVisible = true,
            currentUrl = "http://127.0.0.1:21653/index.html",
            expected = ReplayDispatchAction.NONE
        )
        assertDispatch(
            hasPendingReplay = false,
            webViewVisible = true,
            currentUrl = "http://127.0.0.1:21653/index.html?view=replay",
            expected = ReplayDispatchAction.NONE
        )
    }

    @Test
    fun replayMarkerIsSharedWithTheNavigationTarget() {
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
