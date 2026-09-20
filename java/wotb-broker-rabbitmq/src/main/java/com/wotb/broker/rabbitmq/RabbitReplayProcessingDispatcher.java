package com.wotb.broker.rabbitmq;

import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitOperations;

/**
 * AMQP implementation of the existing {@link ReplayProcessingDispatcher} port: one published
 * {@code parser.request} envelope per {@code submit}.
 *
 * <p>Publishing uses the {@link ParserTopology#JOBS_EXCHANGE} exchange and the
 * {@link ParserTopology#PARSER_REQUEST_ROUTING_KEY} routing key, as a persistent message with
 * {@code attempt = 1}. The envelope is metadata only; the worker resolves its own object keys from
 * {@code jobId}. A publish failure propagates as a runtime exception so the caller fails closed
 * instead of believing a job was dispatched: RabbitMQ never becomes a job-state authority and the
 * authoritative PostgreSQL row plus the caller's outbox decide whether the job is dispatchable.</p>
 *
 * <p>This class is assembly-free: it declares no Spring stereotype and no topology. The caller
 * supplies {@link RabbitOperations} (a {@code RabbitTemplate} or {@code AmqpTemplate} over the
 * configured connection factory) and the codec.</p>
 */
public final class RabbitReplayProcessingDispatcher implements ReplayProcessingDispatcher {

    private static final Logger LOG = LoggerFactory.getLogger(RabbitReplayProcessingDispatcher.class);

    private static final int INITIAL_ATTEMPT = 1;

    private final RabbitOperations rabbitOperations;
    private final ParserMessageCodec codec;

    public RabbitReplayProcessingDispatcher(final RabbitOperations rabbitOperations, final ParserMessageCodec codec) {
        this.rabbitOperations = ParserEnvelopeValues.reference("rabbitOperations", rabbitOperations);
        this.codec = ParserEnvelopeValues.reference("codec", codec);
    }

    @Override
    public void submit(final ReplayProcessingRequest request) {
        final ReplayProcessingRequest command = ParserEnvelopeValues.reference("request", request);
        final List<ParserRequestSource> sources = command.sources().stream()
                .map(RabbitReplayProcessingDispatcher::toWireSource)
                .toList();
        final ParserRequestMessage envelope = new ParserRequestMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                UUID.randomUUID().toString(),
                command.jobId(),
                INITIAL_ATTEMPT,
                Instant.now(),
                sources);
        rabbitOperations.send(
                ParserTopology.JOBS_EXCHANGE,
                ParserTopology.PARSER_REQUEST_ROUTING_KEY,
                persistentJsonMessage(codec.encode(envelope)),
                null);
        LOG.info("dispatched replay processing job {} as attempt {}", command.jobId(), INITIAL_ATTEMPT);
    }

    /**
     * {@inheritDoc}
     *
     * <p><strong>Distributed cancellation cannot be expressed by a message.</strong> The queued
     * message may already be in flight or already consumed, so this dispatcher never publishes a
     * cancel envelope and no cancel routing key exists: a cancel message would either arrive after
     * the work started or be silently ignored, and it would put cancellation state in the broker —
     * a second authority next to PostgreSQL. {@code ACTIVE_COMPLETION_PENDING} is therefore the
     * honest answer: the caller marks the authoritative job {@code cancel_requested}, the worker
     * observes that flag at a safe unit boundary and reports terminal completion through the normal
     * result path, where the control plane already discards late or stale reports.</p>
     *
     * <p>Upgrade path: if broker-level cancellation ever becomes a requirement, it belongs in
     * {@code infra/tofu/rabbitmq} as a reviewed topology change (a dedicated cancel routing key plus
     * its ACL) together with a worker-side cancellation protocol — not as an application-side
     * publish on an existing key.</p>
     */
    @Override
    public CancellationResult cancelQueued(final String jobId) {
        final String job = ParserEnvelopeValues.text("jobId", jobId);
        LOG.info("queued cancellation for job {} is expressed through PostgreSQL job state, not AMQP", job);
        return CancellationResult.ACTIVE_COMPLETION_PENDING;
    }

    private static ParserRequestSource toWireSource(final ReplayProcessingSource source) {
        final ReplayProcessingSource value = ParserEnvelopeValues.reference("sources[]", source);
        return new ParserRequestSource(value.sourceIndex(), value.sourceName());
    }

    private static Message persistentJsonMessage(final byte[] body) {
        final MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setContentEncoding(StandardCharsets.UTF_8.name());
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        return new Message(body, properties);
    }
}
