package com.wotb.broker.rabbitmq;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.listener.api.ChannelAwareMessageListener;

/**
 * Manual-ack consumer of the {@link ParserTopology#PARSER_RESULT_QUEUE} parser outcomes.
 *
 * <p>Transport semantics owned here:</p>
 * <ul>
 *   <li>the handler is given exactly one decoded envelope; a report the handler applies
 *       <em>or</em> classifies as stale/duplicate is acknowledged, because an idempotent no-op is a
 *       success and must not be retried;</li>
 *   <li>a handler exception means "not applicable right now" and is rejected without requeue, so the
 *       result queue's dead-letter exchange parks the message in {@code wotb.parser.dlq} with the
 *       {@code parser.dead} routing key. The message is never dropped and never requeued in a loop:
 *       an operator inspects and replays it deliberately;</li>
 *   <li>a body that does not decode (not JSON, not an object, unknown {@code schemaVersion}, or a
 *       contract violation) is rejected without requeue for the same reason — fail closed is the
 *       only safe answer for a message whose meaning is unknown.</li>
 * </ul>
 *
 * <p>The listener is deliberately not annotated as a Spring component and declares no topology: the
 * caller (PR D/E wiring) attaches it to a {@code SimpleMessageListenerContainer} configured with
 * {@code AcknowledgeMode.MANUAL} on {@link ParserTopology#PARSER_RESULT_QUEUE}, and
 * {@code infra/tofu/rabbitmq} remains the only owner of the queue itself.</p>
 */
public final class ParserResultListener implements ChannelAwareMessageListener {

    private static final Logger LOG = LoggerFactory.getLogger(ParserResultListener.class);

    private final ParserMessageCodec codec;
    private final ParserOutcomeHandler handler;

    public ParserResultListener(final ParserMessageCodec codec, final ParserOutcomeHandler handler) {
        this.codec = ParserEnvelopeValues.reference("codec", codec);
        this.handler = ParserEnvelopeValues.reference("handler", handler);
    }

    @Override
    public void onMessage(final Message message, final Channel channel) throws IOException {
        final MessageProperties properties = message.getMessageProperties();
        final long deliveryTag = properties.getDeliveryTag();
        final String routingKey = properties.getReceivedRoutingKey();

        final ParserOutcomeHandler.Outcome outcome;
        try {
            outcome = dispatch(routingKey, message.getBody());
        } catch (final ParserMessageCodecException e) {
            LOG.error("undecodable parser outcome on routing key {} rejected to the DLQ", routingKey, e);
            channel.basicNack(deliveryTag, false, false);
            return;
        } catch (final RuntimeException e) {
            LOG.error("parser outcome handler failed for routing key {}; rejected to the DLQ", routingKey, e);
            channel.basicNack(deliveryTag, false, false);
            return;
        }

        LOG.info("parser outcome {} acknowledged (routing key {})", outcome, routingKey);
        channel.basicAck(deliveryTag, false);
    }

    private ParserOutcomeHandler.Outcome dispatch(final String routingKey, final byte[] body) {
        if (ParserTopology.PARSER_RESULT_ROUTING_KEY.equals(routingKey)) {
            final ParserResultMessage result = codec.decodeResult(body);
            LOG.debug("consumed parser result for job {} attempt {}", result.jobId(), result.attempt());
            return handler.handleResult(result);
        }
        if (ParserTopology.PARSER_FAILED_ROUTING_KEY.equals(routingKey)) {
            final ParserFailedMessage failed = codec.decodeFailed(body);
            LOG.debug("consumed parser failure for job {} attempt {}", failed.jobId(), failed.attempt());
            return handler.handleFailed(failed);
        }
        throw new ParserMessageCodecException(
                "parser outcome queue received an unbound routing key: " + routingKey,
                ParserMessageCodec.peekJobId(body),
                ParserMessageCodec.peekEventId(body),
                null);
    }
}
