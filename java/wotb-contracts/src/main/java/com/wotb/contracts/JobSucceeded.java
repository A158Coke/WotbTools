package com.wotb.contracts;

import java.time.Instant;
import java.util.Objects;

/** Successful worker callback referring to a result artifact, never embedding its content. */
public record JobSucceeded(
        EventId eventId,
        JobId jobId,
        BatchId batchId,
        Instant occurredAt,
        ObjectKey resultObjectKey
) implements WorkerCallback {
    public JobSucceeded {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(jobId, "jobId");
        Objects.requireNonNull(batchId, "batchId");
        Objects.requireNonNull(occurredAt, "occurredAt");
        Objects.requireNonNull(resultObjectKey, "resultObjectKey");
    }
}
