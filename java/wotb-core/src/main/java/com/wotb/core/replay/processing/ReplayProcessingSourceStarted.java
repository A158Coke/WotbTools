package com.wotb.core.replay.processing;

import java.util.Objects;

/** Value event emitted when local execution starts one replay source. */
public record ReplayProcessingSourceStarted(String jobId, int sourceIndex, String sourceName) {

    public ReplayProcessingSourceStarted {
        jobId = Objects.requireNonNull(jobId, "jobId");
        if (sourceIndex < 0) {
            throw new IllegalArgumentException("sourceIndex must not be negative");
        }
        sourceName = Objects.requireNonNull(sourceName, "sourceName");
    }
}
