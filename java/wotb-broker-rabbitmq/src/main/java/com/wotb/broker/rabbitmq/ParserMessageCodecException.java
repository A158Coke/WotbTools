package com.wotb.broker.rabbitmq;

import java.util.Optional;

/**
 * Fail-closed decoding failure of a parser wire envelope: not JSON, not an envelope shape, an
 * unsupported {@code schemaVersion}, or a field that violates the reviewed contract.
 *
 * <p>It is deliberately a single exception type with a stable message: the consumer must treat
 * every one of these as terminal (reject without requeue, i.e. dead-letter) and must never guess
 * or downgrade an unknown schema version.</p>
 *
 * <p>The identity fields are captured best-effort from the raw body so the consumer can log
 * {@code jobId}/{@code eventId} even when the body could not be decoded.</p>
 */
public final class ParserMessageCodecException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final transient String jobId;
    private final transient String eventId;

    ParserMessageCodecException(
            final String detail,
            final String jobId,
            final String eventId,
            final Throwable cause
    ) {
        super(detail + " (jobId=" + jobId + ", eventId=" + eventId + ")", cause);
        this.jobId = jobId;
        this.eventId = eventId;
    }

    /** Best-effort job identity of the undecodable body, empty when the body did not yield one. */
    public Optional<String> jobId() {
        return Optional.ofNullable(jobId);
    }

    /** Best-effort event identity of the undecodable body, empty when the body did not yield one. */
    public Optional<String> eventId() {
        return Optional.ofNullable(eventId);
    }
}
