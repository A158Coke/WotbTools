package com.wotb.broker.rabbitmq;

import java.time.Instant;
import java.util.List;

/**
 * Wire envelope of {@code parser.request}: the control plane asks the parser worker to process
 * one job.
 *
 * <p>The envelope is metadata only. It never carries replay bytes, parsed content, a filesystem
 * path or a storage URL: the worker derives its own input/artifact object keys from {@code jobId}
 * (the key layout is owned by {@code ObjectStorageKeys}).</p>
 *
 * <p>This record is the wire authority for the request direction. {@code com.wotb.contracts}
 * remains the JVM-side port vocabulary — callers use {@code ReplayProcessingDispatcher} and
 * {@code ReplayProcessingRequest}, and {@link RabbitReplayProcessingDispatcher} derives this
 * envelope from them.</p>
 *
 * @param schemaVersion envelope schema version, exactly {@link ParserMessageCodec#SCHEMA_VERSION}
 * @param eventId       unique identity of this delivery, used for deduplication
 * @param jobId         authoritative processing job identity (PostgreSQL owns job state)
 * @param attempt       delivery attempt, {@code 1} for the initial dispatch
 * @param createdAt     creation instant of this envelope
 * @param sources       per-source metadata; never content
 */
public record ParserRequestMessage(
        String schemaVersion,
        String eventId,
        String jobId,
        int attempt,
        Instant createdAt,
        List<ParserRequestSource> sources
) {

    public ParserRequestMessage {
        schemaVersion = ParserEnvelopeValues.text("schemaVersion", schemaVersion);
        eventId = ParserEnvelopeValues.text("eventId", eventId);
        jobId = ParserEnvelopeValues.text("jobId", jobId);
        attempt = ParserEnvelopeValues.attempt(attempt);
        createdAt = ParserEnvelopeValues.reference("createdAt", createdAt);
        sources = ParserRequestSource.list(sources);
    }
}
