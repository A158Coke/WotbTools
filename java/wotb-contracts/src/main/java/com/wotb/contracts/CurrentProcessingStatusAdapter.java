package com.wotb.contracts;

/**
 * Explicit, contract-specific migration mappings to the future JobStatus vocabulary.
 *
 * <p>Current job and source statuses intentionally have separate entry points. In particular,
 * current job {@code QUEUED} and source {@code PENDING} are not interchangeable public values.
 * A future status that cannot be represented by a current contract is rejected rather than
 * silently collapsed.</p>
 */
public final class CurrentProcessingStatusAdapter {
    private CurrentProcessingStatusAdapter() {
    }

    public static JobStatus jobToFuture(final CurrentJobStatus current) {
        if (current == null) {
            throw new IllegalArgumentException("current job status must not be null");
        }
        return switch (current) {
            case QUEUED -> JobStatus.QUEUED;
            case PROCESSING -> JobStatus.PROCESSING;
            case READY -> JobStatus.SUCCEEDED;
            case FAILED -> JobStatus.FAILED;
            case CANCELLED -> JobStatus.CANCELLED;
        };
    }

    public static CurrentJobStatus futureToJob(final JobStatus future) {
        if (future == null) {
            throw new IllegalArgumentException("future job status must not be null");
        }
        return switch (future) {
            case QUEUED -> CurrentJobStatus.QUEUED;
            case PROCESSING -> CurrentJobStatus.PROCESSING;
            case SUCCEEDED -> CurrentJobStatus.READY;
            case FAILED -> CurrentJobStatus.FAILED;
            case CANCELLED -> CurrentJobStatus.CANCELLED;
        };
    }

    public static JobStatus sourceToFuture(final CurrentSourceStatus current) {
        if (current == null) {
            throw new IllegalArgumentException("current source status must not be null");
        }
        return switch (current) {
            case PENDING -> JobStatus.QUEUED;
            case PROCESSING -> JobStatus.PROCESSING;
            case READY -> JobStatus.SUCCEEDED;
            case FAILED -> JobStatus.FAILED;
        };
    }

    public static CurrentSourceStatus futureToSource(final JobStatus future) {
        if (future == null) {
            throw new IllegalArgumentException("future job status must not be null");
        }
        return switch (future) {
            case QUEUED -> CurrentSourceStatus.PENDING;
            case PROCESSING -> CurrentSourceStatus.PROCESSING;
            case SUCCEEDED -> CurrentSourceStatus.READY;
            case FAILED -> CurrentSourceStatus.FAILED;
            case CANCELLED -> throw new IllegalArgumentException(
                    "future CANCELLED has no current source status representation");
        };
    }
}
