package com.wotb.contracts;

/** Dispatches a value-only replay processing command to the current execution environment. */
public interface ReplayProcessingDispatcher {

    void submit(ReplayProcessingRequest request);

    CancellationResult cancelQueued(String jobId);

    /** Whether cancellation leaves an active execution that will still report terminal completion. */
    enum CancellationResult {
        NO_COMPLETION_PENDING,
        ACTIVE_COMPLETION_PENDING
    }
}
