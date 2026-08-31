package com.wotb.contracts;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ContractsTest {

    @Test
    void mapsCurrentJobContractExhaustivelyAndRoundTrips() {
        Arrays.stream(CurrentJobStatus.values()).forEach(status -> assertEquals(status,
                CurrentProcessingStatusAdapter.futureToJob(
                        CurrentProcessingStatusAdapter.jobToFuture(status))));
    }

    @Test
    void mapsCurrentSourceContractExhaustivelyAndRoundTrips() {
        Arrays.stream(CurrentSourceStatus.values()).forEach(status -> assertEquals(status,
                CurrentProcessingStatusAdapter.futureToSource(
                        CurrentProcessingStatusAdapter.sourceToFuture(status))));
        assertThrows(IllegalArgumentException.class,
                () -> CurrentProcessingStatusAdapter.futureToSource(JobStatus.CANCELLED));
    }

    @Test
    void keepsQueuedJobAndPendingSourceMappingsDistinct() {
        assertEquals(CurrentJobStatus.QUEUED,
                CurrentProcessingStatusAdapter.futureToJob(JobStatus.QUEUED));
        assertEquals(CurrentSourceStatus.PENDING,
                CurrentProcessingStatusAdapter.futureToSource(JobStatus.QUEUED));
        assertEquals(JobStatus.QUEUED,
                CurrentProcessingStatusAdapter.jobToFuture(CurrentJobStatus.QUEUED));
        assertEquals(JobStatus.QUEUED,
                CurrentProcessingStatusAdapter.sourceToFuture(CurrentSourceStatus.PENDING));
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

    @Test
    void requestEventSerializationPreservesStableMetadataShape() throws Exception {
        final JobRequestedEvent request = new JobRequestedEvent(
                new EventId("event-serial"), new JobId("job-serial"), new BatchId("batch-serial"),
                JobType.REPLAY_PROCESSING, new ObjectKey("incoming/replay-serial"),
                Instant.parse("2026-08-31T08:00:00Z"), 2);
        final ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        final String json = mapper.writeValueAsString(request);
        final JsonNode tree = mapper.readTree(json);
        assertEquals("event-serial", tree.at("/eventId/value").asText());
        assertEquals("REPLAY_PROCESSING", tree.at("/jobType").asText());
        assertEquals("2026-08-31T08:00:00Z", tree.at("/createdAt").asText());
        assertEquals(request, mapper.readValue(json, JobRequestedEvent.class));
    }
}
