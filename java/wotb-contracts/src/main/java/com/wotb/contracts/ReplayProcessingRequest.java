package com.wotb.contracts;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Value-only command for replay full processing.
 *
 * <p>The request deliberately contains stable job/source identifiers only: it carries no file path,
 * executable callback, Spring type, or in-memory upload object. The receiving worker resolves its
 * own input/artifact storage from this identity.</p>
 */
public record ReplayProcessingRequest(String jobId, List<ReplayProcessingSource> sources) {

    public ReplayProcessingRequest {
        jobId = ContractValues.required("jobId", jobId);
        sources = sources == null ? List.of() : List.copyOf(sources);
        final Set<Integer> indexes = new HashSet<>();
        for (final ReplayProcessingSource source : sources) {
            if (source == null) {
                throw new IllegalArgumentException("sources must not contain null");
            }
            if (!indexes.add(source.sourceIndex())) {
                throw new IllegalArgumentException("sources must not contain duplicate sourceIndex");
            }
        }
    }
}
