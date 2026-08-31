package com.wotb.contracts;

import java.time.Instant;
import java.util.Objects;

/** Failed worker callback with a stable low-cardinality error code. */
public record JobFailed(
        EventId eventId,
        JobId jobId,
        BatchId batchId,
        Instant occurredAt,
        String errorCode,
        boolean retryable
) implements WorkerCallback {
    public JobFailed {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(jobId, "jobId");
        Objects.requireNonNull(batchId, "batchId");
        Objects.requireNonNull(occurredAt, "occurredAt");
        errorCode = ContractValues.required("errorCode", errorCode);
    }
}
