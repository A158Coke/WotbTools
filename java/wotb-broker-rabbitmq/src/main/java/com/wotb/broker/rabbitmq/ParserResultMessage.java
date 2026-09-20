package com.wotb.broker.rabbitmq;

import java.time.Instant;
import java.util.List;

/**
 * Wire envelope of {@code parser.result}: per-source terminal outcomes of one processing attempt.
 *
 * <p><strong>Why this is not {@code com.wotb.contracts.JobSucceeded}.</strong> The JVM-side
 * {@code WorkerCallback} vocabulary ({@code JobSucceeded} / {@code JobFailed}) describes one
 * whole-callback result and carries a single {@code resultObjectKey}. A processing job has N
 * sources with independent outcomes in one attempt (some {@code READY}, some {@code FAILED}),
 * and a partial report must stay reportable: forcing it into {@code JobSucceeded} would either
 * drop the per-source {@code errorCode} or need N callbacks with no attempt correlation, and
 * adding a per-source list to {@code JobSucceeded} would make the JVM port a second wire schema.
 * This envelope is the wire authority instead: it is keyed by {@code (jobId, attempt)} and lets
 * the control plane apply each source idempotently against its own PostgreSQL state.</p>
 *
 * <p>{@code occurredAt} plus {@code attempt} are what let the consumer recognise a stale or
 * duplicate report; the envelope itself carries no job state and no artifact content.</p>
 *
 * @param schemaVersion envelope schema version, exactly {@link ParserMessageCodec#SCHEMA_VERSION}
 * @param eventId       unique identity of this delivery, used for deduplication
 * @param jobId         authoritative processing job identity
 * @param attempt       attempt this report belongs to; a lower value than the job's current
 *                      attempt is stale and must be ignored by the consumer
 * @param occurredAt    instant the worker finished this attempt
 * @param sources       per-source outcomes of this attempt
 */
public record ParserResultMessage(
        String schemaVersion,
        String eventId,
        String jobId,
        int attempt,
        Instant occurredAt,
        List<ParserSourceOutcome> sources
) {

    public ParserResultMessage {
        schemaVersion = ParserEnvelopeValues.text("schemaVersion", schemaVersion);
        eventId = ParserEnvelopeValues.text("eventId", eventId);
        jobId = ParserEnvelopeValues.text("jobId", jobId);
        attempt = ParserEnvelopeValues.attempt(attempt);
        occurredAt = ParserEnvelopeValues.reference("occurredAt", occurredAt);
        final List<ParserSourceOutcome> copy = ParserEnvelopeValues.reference("sources", sources);
        final List<ParserSourceOutcome> result = List.copyOf(copy);
        for (final ParserSourceOutcome outcome : result) {
            ParserEnvelopeValues.reference("sources[]", outcome);
        }
        sources = result;
    }
}
