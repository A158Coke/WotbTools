package com.wotb.contracts;

import java.time.Instant;
import java.util.Objects;

/** Metadata-only request event. Payload bytes and parsed replay data stay in object storage. */
public record JobRequestedEvent(
        EventId eventId,
        JobId jobId,
        BatchId batchId,
        JobType jobType,
        ObjectKey objectKey,
        Instant createdAt,
        int attempt
) {
    public JobRequestedEvent {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(jobId, "jobId");
        Objects.requireNonNull(batchId, "batchId");
        Objects.requireNonNull(jobType, "jobType");
        Objects.requireNonNull(objectKey, "objectKey");
        Objects.requireNonNull(createdAt, "createdAt");
        if (attempt < 1) {
            throw new IllegalArgumentException("attempt must be positive");
        }
    }
}
