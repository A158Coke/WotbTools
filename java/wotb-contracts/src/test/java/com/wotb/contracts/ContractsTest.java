package com.wotb.contracts;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ContractsTest {

    @Test
    void mapsCurrentReadyToFutureSucceededOnlyThroughExplicitAdapter() {
        assertEquals(JobStatus.SUCCEEDED,
                CurrentProcessingStatusAdapter.toFuture(CurrentProcessingStatus.READY));
        assertEquals(CurrentProcessingStatus.READY,
                CurrentProcessingStatusAdapter.toCurrent(JobStatus.SUCCEEDED));
        assertEquals(JobStatus.QUEUED,
                CurrentProcessingStatusAdapter.toFuture(CurrentProcessingStatus.PENDING));
    }

    @Test
    void validatesMetadataAndKeepsPayloadOutOfRequestEvent() {
        final JobRequestedEvent request = new JobRequestedEvent(
                new EventId("event-1"), new JobId("job-1"), new BatchId("batch-1"),
                JobType.REPLAY_PROCESSING, new ObjectKey("incoming/replay-1"),
                Instant.parse("2026-08-31T08:00:00Z"), 1);
        assertEquals(JobType.REPLAY_PROCESSING, request.jobType());
        assertThrows(IllegalArgumentException.class, () -> new JobId("  "));
        assertThrows(IllegalArgumentException.class, () -> new JobRequestedEvent(
                new EventId("event-1"), new JobId("job-1"), new BatchId("batch-1"),
                JobType.REPLAY_PROCESSING, new ObjectKey("key"), request.createdAt(), 0));
    }

    @Test
    void callbackContractsUseStableErrorCodeAndArtifactReference() {
        final JobFailed failed = new JobFailed(new EventId("event-2"), new JobId("job-1"),
                new BatchId("batch-1"), Instant.EPOCH, "REPLAY_PARSE_FAILED", false);
        assertEquals("REPLAY_PARSE_FAILED", failed.errorCode());
        assertEquals(new ObjectKey("out/result.json"), new JobSucceeded(
                new EventId("event-3"), new JobId("job-1"), new BatchId("batch-1"),
                Instant.EPOCH, new ObjectKey("out/result.json")).resultObjectKey());
    }
}
