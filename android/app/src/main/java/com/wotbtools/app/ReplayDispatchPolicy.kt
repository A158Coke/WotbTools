package com.wotbtools.app

internal enum class ReplayDispatchAction {
    NONE,

    NAVIGATE_REPLAY,

    NOTIFY_WEB
}

internal object ReplayDispatchPolicy {

    internal const val REPLAY_VIEW_MARKER = "view=replay"

    fun decide(
        hasPendingReplay: Boolean,
        webViewVisible: Boolean,
        currentUrl: String?
    ): ReplayDispatchAction {
        if (!hasPendingReplay) return ReplayDispatchAction.NONE
        if (!webViewVisible) return ReplayDispatchAction.NONE
        return if (currentUrl != null && currentUrl.contains(REPLAY_VIEW_MARKER)) {
            ReplayDispatchAction.NOTIFY_WEB
        } else {
            ReplayDispatchAction.NAVIGATE_REPLAY
        }
    }
}
