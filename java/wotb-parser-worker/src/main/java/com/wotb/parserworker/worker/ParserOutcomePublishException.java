package com.wotb.parserworker.worker;

/**
 * A {@code parser.result} / {@code parser.failed} publish did not reach a state that the replay
 * delivery invariant accepts: broker NACK, confirm timeout, connection failure, or a mandatory
 * return (unroutable against the reviewed topology).
 *
 * <p>It is deliberately unchecked and propagates to the consumer, which then rejects the original
 * {@code parser.request} without requeue. Acknowledging a request whose outcome never reached the
 * broker would leave the job hanging in PostgreSQL with no discoverable evidence, whereas the DLQ
 * makes "the result was not delivered" an operator-visible fact — the same invariant PR C enforces
 * for {@code parser.request} dispatch.</p>
 */
public class ParserOutcomePublishException extends RuntimeException {

    public ParserOutcomePublishException(final String message) {
        super(message);
    }

    public ParserOutcomePublishException(final String message, final Throwable cause) {
        super(message, cause);
    }
}
