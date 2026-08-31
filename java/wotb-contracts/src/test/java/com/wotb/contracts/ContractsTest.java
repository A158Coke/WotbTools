package com.wotb.contracts;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ContractsTest {

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
    void callbackSerializationRoundTripsWithoutFreezingNestedIdentifierShape() throws Exception {
        final JobRequestedEvent request = new JobRequestedEvent(
                new EventId("event-serial"), new JobId("job-serial"), new BatchId("batch-serial"),
                JobType.REPLAY_PROCESSING, new ObjectKey("incoming/replay-serial"),
                Instant.parse("2026-08-31T08:00:00Z"), 2);
        final JobSucceeded succeeded = new JobSucceeded(
                new EventId("event-success"), new JobId("job-success"), new BatchId("batch-success"),
                Instant.parse("2026-08-31T08:01:00Z"), new ObjectKey("result/replay.json"));
        final JobFailed failed = new JobFailed(
                new EventId("event-failed"), new JobId("job-failed"), new BatchId("batch-failed"),
                Instant.parse("2026-08-31T08:02:00Z"), "REPLAY_PARSE_FAILED", true);
        final ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        assertEquals(request, mapper.readValue(mapper.writeValueAsString(request), JobRequestedEvent.class));
        assertEquals(succeeded, mapper.readValue(mapper.writeValueAsString(succeeded), JobSucceeded.class));
        assertEquals(failed, mapper.readValue(mapper.writeValueAsString(failed), JobFailed.class));
    }
}
