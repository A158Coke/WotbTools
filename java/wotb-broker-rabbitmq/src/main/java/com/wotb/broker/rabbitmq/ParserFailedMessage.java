package com.wotb.broker.rabbitmq;

import java.time.Instant;

/**
 * Wire envelope of {@code parser.failed}: the whole attempt failed before any per-source outcome
 * existed (for example the worker could not reach object storage).
 *
 * <p>It is the wire twin of {@code com.wotb.contracts.JobFailed} for the "no per-source result"
 * case: {@code errorCode} is a stable low-cardinality code and {@code retryable} is the worker's
 * own judgement. It carries no exception text, no stack trace and no job state — the control plane
 * owns the decision to retry, and PostgreSQL remains the authority for the job's terminal state.
 * {@code attempt} lets the consumer discard a late report.</p>
 *
 * @param schemaVersion envelope schema version, exactly {@link ParserMessageCodec#SCHEMA_VERSION}
 * @param eventId       unique identity of this delivery, used for deduplication
 * @param jobId         authoritative processing job identity
 * @param attempt       attempt this failure belongs to
 * @param occurredAt    instant the worker gave up on this attempt
 * @param errorCode     stable low-cardinality error code
 * @param retryable     whether the worker considers another attempt meaningful
 */
public record ParserFailedMessage(
        String schemaVersion,
        String eventId,
        String jobId,
        int attempt,
        Instant occurredAt,
        String errorCode,
        boolean retryable
) {

    public ParserFailedMessage {
        schemaVersion = ParserEnvelopeValues.text("schemaVersion", schemaVersion);
        eventId = ParserEnvelopeValues.text("eventId", eventId);
        jobId = ParserEnvelopeValues.text("jobId", jobId);
        attempt = ParserEnvelopeValues.attempt(attempt);
        occurredAt = ParserEnvelopeValues.reference("occurredAt", occurredAt);
        errorCode = ParserEnvelopeValues.text("errorCode", errorCode);
    }
}
