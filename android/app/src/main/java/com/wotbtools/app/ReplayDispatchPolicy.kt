package com.wotbtools.app

/**
 * What MainActivity may do with a pending replay when a replay intent arrives.
 *
 * [NONE] is the only "do nothing" outcome: no loadUrl, no evaluateJavascript.
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
 * (`pendingReplay`, container visibility, `WebView.url`) and performs the action.
 *
 * Ownership rules, in order:
 *  1. no pending replay  -> NONE
 *  2. WebView invisible  -> NONE (the container is taken over by a gate / error / update screen)
 *  3. already on the replay view -> NOTIFY_WEB, otherwise NAVIGATE_REPLAY
 *
 * Authentication is deliberately **not** an input any more: Native owns auth and the login runs in
 * an external user-agent (Custom Tabs), so an auth transaction can never own — or be disturbed by —
 * WebView navigation. A replay intent that arrives while the user is logging in is dispatched
 * normally; the page consumes it through the Native Bridge when it is ready.
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
        webViewVisible: Boolean,
        currentUrl: String?
    ): ReplayDispatchAction {
        if (!hasPendingReplay) return ReplayDispatchAction.NONE
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
