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
 *   <li><b>infrastructure failure → retryable.</b> Object storage unavailable on a read, or a lost
 *       broker confirm, throws: the request is rejected with {@code requeue=false} and the reviewed
 *       topology returns it through {@code wotb.parser.retry} after the TTL, so the report says
 *       {@code retryable=true}. The worker keeps no retry state machine of its own and no
 *       PostgreSQL state — the control plane owns the attempt decision;</li>
 *   <li><b>business failure → ack.</b> A replay the canonical parser rejects is terminal: the
 *       outcome (per-source {@code FAILED}, or {@code parser.failed} when no source produced one)
 *       reports the stable error code and the delivery is acknowledged. Re-running the same bytes
 *       cannot change the result;</li>
 *   <li><b>undecodable body → park and ack.</b> The codec fails closed, so a body the worker cannot
 *       understand has no {@code jobId} to report and can never succeed on redelivery. The raw
 *       delivery is parked on {@code wotb.parser.dlq} with {@code parser.dead} — the one terminal
 *       judgement the worker can make alone — and then acknowledged, so the poison message cannot
 *       spin through the retry loop forever.</li>
 * </ul>
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
            parkUndecodableDelivery(message, channel, deliveryTag, routingKey, e);
            return;
        }
        try {
            handler.handle(request);
        } catch (final Exception failure) {
            final String errorCode = ParserRequestHandler.infrastructureErrorCode(failure);
            LOG.error("event=parser_worker_infrastructure_failure jobId={} routingKey={} errorCode={}",
                    request.jobId(), routingKey, errorCode, failure);
            reportFailedBestEffort(request, errorCode);
            // Retryable: the broker's retry queue holds the request for its TTL and returns it to
            // parser.request, so a storage outage or a lost confirm is re-attempted without the
            // worker tracking attempts itself.
            channel.basicNack(deliveryTag, false, false);
            return;
        }
        LOG.info("parser request for job {} acknowledged (routing key {})", request.jobId(), routingKey);
        channel.basicAck(deliveryTag, false);
    }

    /**
     * Terminal path for a body the codec refuses: park the raw delivery on the DLQ, then finish it.
     *
     * <p>Re-delivering undecodable bytes can never succeed, so the request must not re-enter the
     * retry loop; and because there is no decodable {@code jobId} there is no {@code parser.failed}
     * report to publish either. The original bytes go to {@code wotb.parser.dlq} unchanged, which is
     * what an operator needs to diagnose and deliberately replay them.</p>
     *
     * <p>A failed park must not acknowledge: the delivery is rejected without requeue instead, so it
     * waits in the retry queue rather than disappearing as if it had been handled.</p>
     */
    private void parkUndecodableDelivery(final Message message, final Channel channel, final long deliveryTag,
                                         final String routingKey, final ParserMessageCodecException cause)
            throws IOException {
        final byte[] body = message.getBody();
        try {
            handler.parkUndecodableRequest(body);
        } catch (final RuntimeException parkFailure) {
            LOG.error("event=parser_worker_terminal_park_failed routingKey={} bytes={}",
                    routingKey, body.length, parkFailure);
            channel.basicNack(deliveryTag, false, false);
            return;
        }
        LOG.error("event=parser_worker_undecodable_request routingKey={} bytes={} parkedOn={}",
                routingKey, body.length, ParserTopology.PARSER_DLQ, cause);
        channel.basicAck(deliveryTag, false);
    }

    /**
     * Best-effort {@code parser.failed} before rejecting. The publish itself may be why the outcome
     * was never delivered, so a second failure only narrows the operator's diagnosis — it must not
     * replace the rejection that follows.
     */
    private void reportFailedBestEffort(final ParserRequestMessage request, final String errorCode) {
        try {
            handler.publishFailed(request, errorCode, true);
        } catch (final RuntimeException reportingFailure) {
            LOG.error("could not report parser.failed for job {} before rejecting the request",
                    request.jobId(), reportingFailure);
        }
    }
}
