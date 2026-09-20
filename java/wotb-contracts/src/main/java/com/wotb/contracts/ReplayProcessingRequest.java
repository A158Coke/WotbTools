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
 *
 * <p>{@code attempt} is the <b>control-plane owned</b> logical retry counter. The first dispatch of
 * a job is {@link #FIRST_ATTEMPT}; a logical retry is the same job dispatched again at a higher
 * attempt. The broker adapter stamps it into the wire envelope, the worker echoes it in every
 * report, and the control plane discards reports whose attempt is older than the one it dispatched.
 * The transport therefore never invents an attempt: only the control plane decides that a new
 * attempt exists.</p>
 *
 * @param jobId   authoritative processing job identity
 * @param sources the job's sources in dispatch order
 * @param attempt 1-based attempt this dispatch belongs to
 */
public record ReplayProcessingRequest(String jobId, List<ReplayProcessingSource> sources, int attempt) {

    /** Attempt of a job's first dispatch; every logical retry increments it. */
    public static final int FIRST_ATTEMPT = 1;

    public ReplayProcessingRequest {
        jobId = ContractValues.required("jobId", jobId);
        sources = sources == null ? List.of() : List.copyOf(sources);
        if (attempt < FIRST_ATTEMPT) {
            throw new IllegalArgumentException("attempt must be at least " + FIRST_ATTEMPT + ": " + attempt);
        }
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
