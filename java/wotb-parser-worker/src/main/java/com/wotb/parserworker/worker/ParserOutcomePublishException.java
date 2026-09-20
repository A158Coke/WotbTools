package com.wotb.parserworker.worker;

/**
 * A {@code parser.result} / {@code parser.failed} publish did not reach a state that the replay
 * delivery invariant accepts: broker NACK, confirm timeout, connection failure, or a mandatory
 * return (unroutable against the reviewed topology).
 *
 * <p>It is deliberately unchecked and propagates to the consumer, which settles nothing: no second
 * outcome, no acknowledgement, no rejection. An uncertain confirm does not prove the message was
 * not routed, so the only safe reaction is to leave the delivery unsettled and let the transport
 * redeliver the same attempt — see {@link ParserRequestListener}.</p>
 */
public class ParserOutcomePublishException extends RuntimeException {

    public ParserOutcomePublishException(final String message) {
        super(message);
    }

    public ParserOutcomePublishException(final String message, final Throwable cause) {
        super(message, cause);
    }
}
