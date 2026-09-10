package com.wotbtools.app

/**
 * What an incoming `consumePendingReplay` ACK may do to the pending replay slot.
 *
 * [STALE] and [MISSING_IDENTITY] both mean "clear nothing": the only outcome that may touch the slot is
 * [SUCCESS], and it requires the ACK to name exactly the pending that is still there.
 */
internal enum class PendingReplayAckResult {
    /** The ACK names exactly the current pending -> compare-and-clear is allowed. */
    SUCCESS,

    /** The slot already holds a newer replay (or nothing) -> the ACK is stale; never clear. */
    STALE,

    /** The ACK carries no identity -> never clear; an argument-less ACK must not exist. */
    MISSING_IDENTITY
}

/**
 * Single source of truth for "may this ACK clear the pending replay".
 *
 * Kept completely free of Android framework types (no Context / WebView / Uri) so the whole decision is a
 * plain JVM unit test under `testDebugUnitTest`; MainActivity only reads `pendingReplay?.pendingId`,
 * performs the clear, and logs short refs.
 *
 * The race this closes: the Web app is processing pending A, a new replay B arrives and (single slot,
 * latest wins) replaces it, then the server accepts A and the Web app ACKs A. An argument-less ACK would
 * clear B and silently drop the replay the user just opened; identity-matched ACK instead reports
 * [STALE] and leaves the slot untouched (a stale ACK can never destroy a newer pending).
 *
 * Rules, in order:
 *  1. expected missing / blank   -> [PendingReplayAckResult.MISSING_IDENTITY]
 *  2. no current pending, or current != expected -> [PendingReplayAckResult.STALE]
 *  3. otherwise                  -> [PendingReplayAckResult.SUCCESS]
 *
 * Identity is the full `pendingId` and the comparison is exact: no trimming, no case folding, no prefix
 * matching. The 8-character short ref is a log convenience only and is never a valid identity.
 */
internal object PendingReplayAckPolicy {

    fun decide(currentPendingId: String?, expectedPendingId: String?): PendingReplayAckResult {
        if (expectedPendingId.isNullOrBlank()) return PendingReplayAckResult.MISSING_IDENTITY
        if (currentPendingId == null || currentPendingId != expectedPendingId) {
            return PendingReplayAckResult.STALE
        }
        return PendingReplayAckResult.SUCCESS
    }
}
