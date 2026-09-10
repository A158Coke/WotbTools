package com.wotb.core.replay.processing;

/**
 * Local in-process lifecycle bridge consumed by the coordinator.
 *
 * <p>A remote worker must publish value events through its wire contract instead of implementing
 * this JVM interface.
 */
public interface ReplayProcessingLifecycle {

    void jobStarted(String jobId);

    void sourceStarted(String jobId, int sourceIndex, String sourceName);

    void sourceCompleted(ReplayProcessingSourceOutcome outcome);

    void jobCompleted(String jobId);
}
