package com.wotb.contracts;

/** Explicit migration mapping between the current processing vocabulary and future JobStatus. */
public final class CurrentProcessingStatusAdapter {
    private CurrentProcessingStatusAdapter() {
    }

    public static JobStatus toFuture(final CurrentProcessingStatus current) {
        if (current == null) {
            throw new IllegalArgumentException("current processing status must not be null");
        }
        return switch (current) {
            case PENDING, QUEUED -> JobStatus.QUEUED;
            case PROCESSING -> JobStatus.PROCESSING;
            case READY -> JobStatus.SUCCEEDED;
            case FAILED -> JobStatus.FAILED;
            case CANCELLED -> JobStatus.CANCELLED;
        };
    }

    public static CurrentProcessingStatus toCurrent(final JobStatus future) {
        if (future == null) {
            throw new IllegalArgumentException("future job status must not be null");
        }
        return switch (future) {
            case QUEUED -> CurrentProcessingStatus.PENDING;
            case PROCESSING -> CurrentProcessingStatus.PROCESSING;
            case SUCCEEDED -> CurrentProcessingStatus.READY;
            case FAILED -> CurrentProcessingStatus.FAILED;
            case CANCELLED -> CurrentProcessingStatus.CANCELLED;
        };
    }
}
