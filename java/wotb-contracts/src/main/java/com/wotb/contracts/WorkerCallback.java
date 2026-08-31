package com.wotb.contracts;

import java.time.Instant;

/** Metadata-only worker result callback. */
public sealed interface WorkerCallback permits JobSucceeded, JobFailed {
    EventId eventId();

    JobId jobId();

    BatchId batchId();

    Instant occurredAt();
}
