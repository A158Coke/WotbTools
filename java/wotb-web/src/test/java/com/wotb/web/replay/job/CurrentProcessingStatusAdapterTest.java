package com.wotb.web.replay.job;

import com.wotb.contracts.JobStatus;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CurrentProcessingStatusAdapterTest {

    @Test
    void mapsEveryRealJobStatusAndRoundTrips() {
        Arrays.stream(ReplayProcessingJob.Status.values()).forEach(status -> assertEquals(status,
                CurrentProcessingStatusAdapter.futureToJob(
                        CurrentProcessingStatusAdapter.jobToFuture(status))));
    }

    @Test
    void mapsEveryRealSourceStatusAndRoundTrips() {
        Arrays.stream(ReplayProcessingJob.SourceStatus.values()).forEach(status -> assertEquals(status,
                CurrentProcessingStatusAdapter.futureToSource(
                        CurrentProcessingStatusAdapter.sourceToFuture(status))));
        assertThrows(IllegalArgumentException.class,
                () -> CurrentProcessingStatusAdapter.futureToSource(JobStatus.CANCELLED));
    }

    @Test
    void keepsRealJobQueuedAndSourcePendingDistinct() {
        assertEquals(ReplayProcessingJob.Status.QUEUED,
                CurrentProcessingStatusAdapter.futureToJob(JobStatus.QUEUED));
        assertEquals(ReplayProcessingJob.SourceStatus.PENDING,
                CurrentProcessingStatusAdapter.futureToSource(JobStatus.QUEUED));
    }

    @Test
    void mapsEveryRealExportStatusAndRoundTrips() {
        Arrays.stream(ExportJob.Status.values()).forEach(status -> assertEquals(status,
                CurrentProcessingStatusAdapter.futureToExport(
                        CurrentProcessingStatusAdapter.exportToFuture(status))));
    }
}
