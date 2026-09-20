package com.wotb.broker.rabbitmq;

/**
 * Application port that decides what a consumed parser outcome means.
 *
 * <p>{@link ParserResultListener} owns transport semantics only (manual ack, dead-lettering) and
 * deliberately owns no idempotency or staleness policy: the implementation decides from the
 * authoritative PostgreSQL job state whether a report is new, a duplicate, or stale, and returns
 * {@link Outcome}. Both outcomes are acknowledged — an ignored stale or duplicate report is a
 * successful no-op, not a failure, so it must not be retried and must not reach the DLQ.</p>
 *
 * <p>Throwing from a handler means "this delivery cannot be applied": the listener rejects it
 * without requeue, so the message dead-letters to {@code wotb.parser.dlq} and stays there for an
 * operator. Never signal a transient database error by returning an outcome; throw instead, and let
 * the operator redeliver the parked message once the cause is gone.</p>
 */
public interface ParserOutcomeHandler {

    /** Applies a per-source result report. */
    Outcome handleResult(ParserResultMessage message);

    /** Applies a whole-attempt failure report. */
    Outcome handleFailed(ParserFailedMessage message);

    /** What the consumer should do with a report that was delivered. */
    enum Outcome {

        /** The report changed (or confirmed) authoritative state. */
        APPLIED,

        /** The report is stale or already applied; a successful no-op. */
        IGNORED_STALE_OR_DUPLICATE
    }
}
