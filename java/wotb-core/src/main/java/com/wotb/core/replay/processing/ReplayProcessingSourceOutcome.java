package com.wotb.core.replay.processing;

import com.wotb.core.parse.Replays;

import java.util.Objects;

/** Immutable one-source full-processing outcome returned from the execution side. */
public record ReplayProcessingSourceOutcome(String jobId, int sourceIndex, String sourceName,
                                            Replays.ParsedEntry entry, boolean processedSuccessfully) {

    public ReplayProcessingSourceOutcome {
        jobId = Objects.requireNonNull(jobId, "jobId");
        if (sourceIndex < 0) {
            throw new IllegalArgumentException("sourceIndex must not be negative");
        }
        sourceName = Objects.requireNonNull(sourceName, "sourceName");
        entry = Objects.requireNonNull(entry, "entry");
    }
}
