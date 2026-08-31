package com.wotb.web.replay.job;

import com.wotb.contracts.JobStatus;

/**
 * Migration boundary between the real current replay-job/source enums and future JobStatus.
 *
 * <p>The adapter lives at the Web boundary because the pure contracts artifact must not depend
 * on current Web implementation types. Job {@code QUEUED} and source {@code PENDING} therefore
 * have separate methods and never share a lossy current enum.</p>
 */
public final class CurrentProcessingStatusAdapter {
    private CurrentProcessingStatusAdapter() {
    }

    public static JobStatus jobToFuture(final ReplayProcessingJob.Status current) {
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

    public static ReplayProcessingJob.Status futureToJob(final JobStatus future) {
        if (future == null) {
            throw new IllegalArgumentException("future job status must not be null");
        }
        return switch (future) {
            case QUEUED -> ReplayProcessingJob.Status.QUEUED;
            case PROCESSING -> ReplayProcessingJob.Status.PROCESSING;
            case SUCCEEDED -> ReplayProcessingJob.Status.READY;
            case FAILED -> ReplayProcessingJob.Status.FAILED;
            case CANCELLED -> ReplayProcessingJob.Status.CANCELLED;
        };
    }

    public static JobStatus sourceToFuture(final ReplayProcessingJob.SourceStatus current) {
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

    public static ReplayProcessingJob.SourceStatus futureToSource(final JobStatus future) {
        if (future == null) {
            throw new IllegalArgumentException("future job status must not be null");
        }
        return switch (future) {
            case QUEUED -> ReplayProcessingJob.SourceStatus.PENDING;
            case PROCESSING -> ReplayProcessingJob.SourceStatus.PROCESSING;
            case SUCCEEDED -> ReplayProcessingJob.SourceStatus.READY;
            case FAILED -> ReplayProcessingJob.SourceStatus.FAILED;
            case CANCELLED -> throw new IllegalArgumentException(
                    "future CANCELLED has no current source status representation");
        };
    }

    public static JobStatus exportToFuture(final ExportJob.Status current) {
        if (current == null) {
            throw new IllegalArgumentException("current export status must not be null");
        }
        return switch (current) {
            case QUEUED -> JobStatus.QUEUED;
            case PROCESSING -> JobStatus.PROCESSING;
            case READY -> JobStatus.SUCCEEDED;
            case FAILED -> JobStatus.FAILED;
            case CANCELLED -> JobStatus.CANCELLED;
        };
    }

    public static ExportJob.Status futureToExport(final JobStatus future) {
        if (future == null) {
            throw new IllegalArgumentException("future job status must not be null");
        }
        return switch (future) {
            case QUEUED -> ExportJob.Status.QUEUED;
            case PROCESSING -> ExportJob.Status.PROCESSING;
            case SUCCEEDED -> ExportJob.Status.READY;
            case FAILED -> ExportJob.Status.FAILED;
            case CANCELLED -> ExportJob.Status.CANCELLED;
        };
    }
}
