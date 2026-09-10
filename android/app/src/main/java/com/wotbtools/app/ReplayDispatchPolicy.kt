package com.wotbtools.app

/**
 * What MainActivity may do with a pending replay when a replay intent arrives.
 *
 * [NONE] is the navigation-ownership boundary (RC5): inside an authentication transaction a new
 * replay intent is only enqueued, and must never change WebView navigation.
 */
internal enum class ReplayDispatchAction {
    /** Enqueue only: no loadUrl, no evaluateJavascript. */
    NONE,

    /** Switch the WebView to the canonical replay view; the Web app consumes the pending replay. */
    NAVIGATE_REPLAY,

    /** The replay workspace is already loaded; tell the Web app to consume the pending replay. */
    NOTIFY_WEB
}

/**
 * Single source of truth for "does this pending replay get dispatched, and how".
 *
 * Kept completely free of Android framework types (no Uri / Context / WebView / View) so the whole
 * decision is a plain JVM unit test under `testDebugUnitTest`; MainActivity only reads the inputs
 * (`pendingReplay`, `inAuthFlow`, container visibility, `WebView.url`) and performs the action.
 *
 * Ownership rules, in order (equivalent to the previous inline branches in `onNewIntent`):
 *  1. no pending replay  -> NONE
 *  2. `inAuthFlow`       -> NONE (authentication owns navigation; replay is deferred, not dropped)
 *  3. WebView invisible  -> NONE (the container is taken over by a gate / error / update screen)
 *  4. already on the replay view -> NOTIFY_WEB, otherwise NAVIGATE_REPLAY
 *
 * The verified auth-return path (`handleAuthReturnHot` / `handleAuthReturnColdStart`) is not part of
 * this decision: it always sets `inAuthFlow = true` first, so rule 2 already guarantees an auth
 * return never triggers replay navigation.
 */
internal object ReplayDispatchPolicy {

    /**
     * Canonical replay-view query marker. MainActivity builds its `REPLAY_URL` from this constant so
     * "the URL we navigate to" and "the URL we recognize as already being the replay view" cannot
     * drift apart.
     */
    internal const val REPLAY_VIEW_MARKER = "view=replay"

    fun decide(
        hasPendingReplay: Boolean,
        inAuthFlow: Boolean,
        webViewVisible: Boolean,
        currentUrl: String?
    ): ReplayDispatchAction {
        if (!hasPendingReplay) return ReplayDispatchAction.NONE
        if (inAuthFlow) return ReplayDispatchAction.NONE
        if (!webViewVisible) return ReplayDispatchAction.NONE
        return if (currentUrl != null && currentUrl.contains(REPLAY_VIEW_MARKER)) {
            // Already on the replay workspace: notify in place instead of reloading (a reload would
            // drop the current Web app state). Consuming the pending replay keeps this exactly-once.
            ReplayDispatchAction.NOTIFY_WEB
        } else {
            ReplayDispatchAction.NAVIGATE_REPLAY
        }
    }
}
