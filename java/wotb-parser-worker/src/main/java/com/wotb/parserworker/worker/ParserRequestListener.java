package com.wotb.parserworker.worker;

import com.rabbitmq.client.Channel;
import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserMessageCodecException;
import com.wotb.broker.rabbitmq.ParserRequestMessage;
import com.wotb.broker.rabbitmq.ParserTopology;
import java.io.IOException;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.listener.api.ChannelAwareMessageListener;

/**
 * Manual-ack consumer of {@link ParserTopology#PARSER_QUEUE}.
 *
 * <p>Transport semantics owned here:</p>
 * <ul>
 *   <li><b>ack only after a confirmed outcome.</b> {@link ParserRequestHandler} publishes
 *       {@code parser.result} / {@code parser.failed} with correlated publisher confirms and only
 *       then returns. Acknowledging earlier would let PostgreSQL keep a job that no outcome will
 *       ever reach — the same invariant PR C enforces on the dispatch direction;</li>
 *   <li><b>business failure → ack.</b> A replay the canonical parser rejects is terminal: the
 *       outcome reports the stable error code per source and the delivery is acknowledged.
 *       Re-running the same bytes cannot change the result;</li>
 *   <li><b>infrastructure work failure → report, then ack.</b> Object storage unavailable on a read
 *       or a write throws. The worker publishes {@code parser.failed} for the <em>same</em>
 *       {@code jobId} and {@code attempt} with {@code retryable=true}, waits for the broker to
 *       confirm it, and acknowledges the request. It deliberately does <b>not</b> reject the
 *       request: retrying is a control-plane decision, not a broker-side loop (see below);</li>
 *   <li><b>outcome publish uncertainty → settle nothing.</b> A lost, timed-out or failed confirm for
 *       {@code parser.result} does <em>not</em> prove the outcome was not routed — the broker may
 *       already have delivered it. Reporting {@code parser.failed} as well would produce two
 *       contradictory outcomes for one {@code (jobId, attempt)}, so the worker publishes nothing,
 *       acknowledges nothing and rejects nothing: the transport redelivers the same attempt and the
 *       worker reproduces the same {@code parser.result}, which the control plane applies
 *       idempotently;</li>
 *   <li><b>report could not be delivered → no ack, no nack.</b> If publishing {@code parser.failed}
 *       fails, the request is left unacknowledged so ordinary AMQP connection/channel redelivery
 *       brings back the same {@code attempt} — never a new logical attempt, and never a silent
 *       acknowledgement.</li>
 * </ul>
 *
 * <p><b>Retry policy is control-plane owned.</b> The worker never routes a job through
 * {@code wotb.parser.retry}: that queue is not a worker retry mechanism. The control plane (which
 * holds PostgreSQL and is the only authority on job state) receives {@code parser.failed},
 * decides whether the attempt may be retried, and — only if it may — advances the authoritative
 * attempt and dispatches a new {@code parser.request} with {@code attempt + 1}. Two distinct
 * concepts must not be conflated:</p>
 * <ul>
 *   <li><b>logical retry</b> = a new control-plane dispatch with {@code attempt + 1};</li>
 *   <li><b>transport redelivery</b> = the <em>same</em> attempt arriving again, only because the
 *       original delivery was never acknowledged (crash, lost confirm, publish failure).</li>
 * </ul>
 * The worker owns no retry counter or budget, and no job state: it has no database access and must
 * never gain one for this.</p>
 *
 * <p>Processing is idempotent: all keys derive from {@code (jobId, sourceIndex)} and every write
 * is an overwrite. A redelivered request therefore re-runs its sources and reproduces the same
 * objects.</p>
 */
public class ParserRequestListener implements ChannelAwareMessageListener {

    private static final Logger LOG = LoggerFactory.getLogger(ParserRequestListener.class);

    private final ParserMessageCodec codec;
    private final ParserRequestHandler handler;

    public ParserRequestListener(final ParserMessageCodec codec, final ParserRequestHandler handler) {
        this.codec = Objects.requireNonNull(codec, "codec");
        this.handler = Objects.requireNonNull(handler, "handler");
    }

    @Override
    public void onMessage(final Message message, final Channel channel) throws IOException {
        final MessageProperties properties = message.getMessageProperties();
        final long deliveryTag = properties.getDeliveryTag();
        final String routingKey = properties.getReceivedRoutingKey();

        final ParserRequestMessage request;
        try {
            request = codec.decodeRequest(message.getBody());
        } catch (final ParserMessageCodecException e) {
            // No jobId/attempt exists to report and re-delivering undecodable bytes can never
            // succeed, so this is the one delivery the worker settles without a control-plane
            // round trip: park the original bytes for an operator and finish it.
            LOG.error("event=parser_worker_undecodable_request routingKey={} bytes={} parkedOn={}",
                    routingKey, message.getBody().length, ParserTopology.PARSER_DLQ, e);
            parkOnDlq(message.getBody(), channel, deliveryTag, routingKey);
            return;
        }
        try {
            handler.handle(request);
        } catch (final ParserOutcomePublishException uncertainOutcome) {
            // A lost/timed-out confirm does NOT prove the outcome was not routed: the broker may
            // already have delivered parser.result. Publishing parser.failed here would create two
            // contradictory outcomes for the same (jobId, attempt), and acking would settle an
            // attempt whose real outcome is unknown. Settle nothing: the transport redelivers the
            // same attempt and the worker reproduces the same parser.result, which the control plane
            // is required to apply idempotently.
            LOG.error("event=parser_worker_outcome_publish_uncertain jobId={} attempt={} routingKey={};"
                            + " not reporting a second outcome and not acknowledging the request",
                    request.jobId(), request.attempt(), routingKey, uncertainOutcome);
            return;
        } catch (final Exception failure) {
            reportInfrastructureFailure(request, message, channel, deliveryTag, routingKey, failure);
            return;
        }
        LOG.info("parser request for job {} acknowledged (routing key {})", request.jobId(), routingKey);
        channel.basicAck(deliveryTag, false);
    }

    /**
     * Reports a whole-attempt infrastructure <em>work</em> failure (object storage unreachable on a
     * read or a write) and only then acknowledges the request.
     *
     * <p>Nothing is acknowledged unless the report reached a confirmed broker state, and a report
     * that cannot be delivered settles nothing either — the transport then redelivers the same
     * attempt. Outcome publish uncertainty never reaches this method: it is handled before, because
     * it must not become a second semantic outcome.</p>
     */
    private void reportInfrastructureFailure(final ParserRequestMessage request,
                                             final Message message,
                                             final Channel channel,
                                             final long deliveryTag,
                                             final String routingKey,
                                             final Exception failure) throws IOException {
        final String errorCode = ParserRequestHandler.STORAGE_UNAVAILABLE_WIRE_CODE;
        try {
            // Confirmed delivery: returns only once the broker acknowledged the publish.
            handler.publishFailed(request, errorCode, true);
        } catch (final RuntimeException undelivered) {
            LOG.error("event=parser_worker_failure_report_undelivered jobId={} attempt={} routingKey={}"
                            + " errorCode={}; leaving the request unacknowledged so the transport"
                            + " redelivers the same attempt",
                    request.jobId(), request.attempt(), routingKey, errorCode, undelivered);
            return;
        }
        LOG.error("event=parser_worker_infrastructure_failure jobId={} attempt={} routingKey={} errorCode={}"
                        + " reported=true retryDecision=control-plane",
                request.jobId(), request.attempt(), routingKey, errorCode, failure);
        channel.basicAck(deliveryTag, false);
    }

    /**
     * Parks the delivery verbatim on {@code wotb.parser.dlq} and acknowledges it.
     *
     * <p>The parked message is a freshly published copy, so it carries no dead-letter history. If the
     * park cannot be delivered nothing is settled — no ack, no nack — and the transport redelivers
     * the same attempt instead.</p>
     */
    private void parkOnDlq(final byte[] body, final Channel channel, final long deliveryTag,
                           final String routingKey) throws IOException {
        try {
            handler.parkTerminalRequest(body);
        } catch (final RuntimeException undelivered) {
            LOG.error("event=parser_worker_terminal_park_undelivered routingKey={} bytes={};"
                            + " leaving the delivery unacknowledged",
                    routingKey, body.length, undelivered);
            return;
        }
        channel.basicAck(deliveryTag, false);
    }
}
