package com.wotb.core.replay.processing;

import java.util.Objects;

/** Value event emitted when local execution has completed every source in a job. */
public record ReplayProcessingJobCompleted(String jobId) {

    public ReplayProcessingJobCompleted {
        jobId = Objects.requireNonNull(jobId, "jobId");
    }
}
