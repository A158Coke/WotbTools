package com.wotbtools.app

internal enum class PendingReplayAckResult {
    SUCCESS,

    STALE,

    MISSING_IDENTITY
}

internal object PendingReplayAckPolicy {

    fun decide(currentPendingId: String?, expectedPendingId: String?): PendingReplayAckResult {
        if (expectedPendingId.isNullOrBlank()) return PendingReplayAckResult.MISSING_IDENTITY
        if (currentPendingId == null || currentPendingId != expectedPendingId) {
            return PendingReplayAckResult.STALE
        }
        return PendingReplayAckResult.SUCCESS
    }
}
