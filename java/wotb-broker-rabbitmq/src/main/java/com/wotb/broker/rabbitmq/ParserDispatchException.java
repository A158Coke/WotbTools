package com.wotb.broker.rabbitmq;

/**
 * A {@code parser.request} publish did not reach a state that the distributed replay delivery
 * invariant accepts: broker NACK, confirm timeout, connection failure, or a mandatory return
 * (unroutable against the reviewed topology).
 *
 * <p>It is deliberately unchecked and propagates to the caller. {@code
 * ReplayProcessingJobService} treats a successful {@code submit} as the commit point for the
 * authoritative operationId identity, so a swallowed publish failure would produce a job that
 * PostgreSQL believes is dispatched while no work item exists in {@code wotb.parser} — the worker
 * would never run it and the job would hang forever. Failing closed keeps the caller's retry path
 * (same operationId) meaningful.</p>
 *
 * <p>There is intentionally <b>no</b> outbox in this module: durable dispatch state belongs to the
 * authoritative PostgreSQL job domain, not to the broker adapter.</p>
 */
public class ParserDispatchException extends RuntimeException {

    public ParserDispatchException(final String message) {
        super(message);
    }

    public ParserDispatchException(final String message, final Throwable cause) {
        super(message, cause);
    }
}
