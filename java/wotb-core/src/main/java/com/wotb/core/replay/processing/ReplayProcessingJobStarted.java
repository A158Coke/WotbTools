package com.wotb.core.replay.processing;

import java.util.Objects;

/** Value event emitted when local execution starts a replay processing job. */
public record ReplayProcessingJobStarted(String jobId) {

    public ReplayProcessingJobStarted {
        jobId = Objects.requireNonNull(jobId, "jobId");
    }
}
