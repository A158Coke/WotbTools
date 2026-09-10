package com.wotb.core.replay.processing;

/**
 * Value-event sink consumed by the coordinator. Local processing invokes it in-process; a remote
 * worker can publish the same events as completion messages without changing the command contract.
 */
public interface ReplayProcessingLifecycle {

    boolean isCancelled(String jobId);

    void jobStarted(String jobId);

    void sourceStarted(String jobId, int sourceIndex, String sourceName);

    void sourceCompleted(ReplayProcessingSourceOutcome outcome);

    void jobCompleted(String jobId);
}
