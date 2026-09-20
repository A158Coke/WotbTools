package com.wotb.broker.rabbitmq;

/**
 * Canonical wire names of the RabbitMQ replay-parser protocol.
 *
 * <p><strong>The single owner of the static RabbitMQ topology is the OpenTofu root
 * {@code infra/tofu/rabbitmq}.</strong> Applications only publish and consume; they must never
 * declare, redeclare or assert these exchanges, queues or bindings at startup. A second owner
 * makes the broker fail with {@code PRECONDITION_FAILED} as soon as a declared argument differs,
 * and it turns a reviewed OpenTofu diff into an invisible runtime side effect. These constants
 * exist so that application code has exactly one place to read the names from — not so that it
 * can create them.</p>
 *
 * <p>Routing keys are not part of a RabbitMQ ACL: a RabbitMQ permission grants an exchange or
 * queue by name, so the {@code write} grant that publishes {@code parser.result} is the same
 * grant that publishes {@code parser.request}.</p>
 */
public final class ParserTopology {

    /** Durable topic exchange carrying every parser protocol message. */
    public static final String JOBS_EXCHANGE = "wotb.jobs";

    /** Work queue of the parser worker (its DLX returns rejected messages to the retry queue). */
    public static final String PARSER_QUEUE = "wotb.parser";

    /** Broker-side retry delay queue; no consumer, TTL re-routes back to {@code parser.request}. */
    public static final String PARSER_RETRY_QUEUE = "wotb.parser.retry";

    /** Terminal failure queue; no TTL, operator-inspected. */
    public static final String PARSER_DLQ = "wotb.parser.dlq";

    /** Queue carrying per-source outcomes back to the replay control plane. */
    public static final String PARSER_RESULT_QUEUE = "wotb.parser.result";

    /** Control plane dispatches one replay processing job. */
    public static final String PARSER_REQUEST_ROUTING_KEY = "parser.request";

    /** A retryable worker rejection travels through the retry queue with this key. */
    public static final String PARSER_RETRY_ROUTING_KEY = "parser.retry";

    /** Terminal failure; bound to {@link #PARSER_DLQ}. */
    public static final String PARSER_DEAD_ROUTING_KEY = "parser.dead";

    /** Per-source success/failure outcome; bound to {@link #PARSER_RESULT_QUEUE}. */
    public static final String PARSER_RESULT_ROUTING_KEY = "parser.result";

    /** Whole-message failure (no per-source outcome); bound to {@link #PARSER_RESULT_QUEUE}. */
    public static final String PARSER_FAILED_ROUTING_KEY = "parser.failed";

    private ParserTopology() {
    }
}
