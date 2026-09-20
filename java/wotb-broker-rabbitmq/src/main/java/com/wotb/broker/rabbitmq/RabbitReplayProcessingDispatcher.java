package com.wotb.broker.rabbitmq;

import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

/**
 * AMQP implementation of the existing {@link ReplayProcessingDispatcher} port: one published
 * {@code parser.request} envelope per {@code submit}.
 *
 * <p>Publishing uses the {@link ParserTopology#JOBS_EXCHANGE} exchange and the
 * {@link ParserTopology#PARSER_REQUEST_ROUTING_KEY} routing key, as a persistent message carrying
 * the command's own {@code attempt}. The envelope is metadata only; the worker resolves its own
 * object keys from {@code jobId}.</p>
 *
 * <p><b>This adapter never invents an attempt.</b> {@code attempt} belongs to the command because
 * only the control plane may decide that a logical retry exists (it is the owner of the retry
 * budget and of the authoritative job state); the adapter's job is to place that decision on the
 * wire unchanged. A first dispatch carries {@code 1}, a retry carries the control plane's
 * {@code attempt + 1}.</p>
 *
 * <p><b>Delivery semantics: a successful return means the broker confirmed the publish and the
 * message was routable.</b> {@link #submit} waits for the correlated publisher confirm and then
 * rejects a mandatory return, so a lost publish, a broker NACK, a confirm timeout, a connection
 * failure or an unroutable routing key all surface as {@link ParserDispatchException}. That matters
 * because {@code ReplayProcessingJobService} treats a successful {@code submit} as the commit point
 * for the authoritative operationId identity: fire-and-forget publishing here would let PostgreSQL
 * record a dispatched job whose work item never reached {@code wotb.parser}, and the job would hang
 * forever. Durable dispatch state is deliberately <b>not</b> modelled here — an outbox belongs to
 * the authoritative PostgreSQL job domain, not to the broker adapter.</p>
 *
 * <p>The constructor fails closed unless the supplied {@link RabbitTemplate} actually has confirmed
 * delivery available (correlated publisher confirms and publisher returns on its connection
 * factory); {@code mandatory} is forced on so the unroutable path is always active. This class is
 * assembly-free: it declares no Spring stereotype and no topology.</p>
 */
public final class RabbitReplayProcessingDispatcher implements ReplayProcessingDispatcher {

    private static final Logger LOG = LoggerFactory.getLogger(RabbitReplayProcessingDispatcher.class);

    private final RabbitTemplate template;
    private final ParserMessageCodec codec;
    private final Duration confirmTimeout;

    public RabbitReplayProcessingDispatcher(final RabbitTemplate template,
                                            final ParserMessageCodec codec,
                                            final Duration confirmTimeout) {
        this.template = ParserEnvelopeValues.reference("template", template);
        this.codec = ParserEnvelopeValues.reference("codec", codec);
        this.confirmTimeout = requirePositive("confirmTimeout", confirmTimeout);
        requireConfirmedDelivery(template);
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
                command.attempt(),
                Instant.now(),
                sources);

        final CorrelationData correlation = new CorrelationData(envelope.eventId());
        try {
            template.send(
                    ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_REQUEST_ROUTING_KEY,
                    persistentJsonMessage(codec.encode(envelope)),
                    correlation);
        } catch (final RuntimeException publishFailure) {
            throw new ParserDispatchException(
                    "parser.request publish failed for job " + command.jobId(), publishFailure);
        }

        final CorrelationData.Confirm confirm = awaitConfirm(correlation, command.jobId());
        if (!confirm.isAck()) {
            throw new ParserDispatchException("broker nacked parser.request for job "
                    + command.jobId() + ": " + confirm.getReason());
        }
        final ReturnedMessage returned = correlation.getReturned();
        if (returned != null) {
            throw new ParserDispatchException("parser.request for job " + command.jobId()
                    + " was unroutable: replyCode=" + returned.getReplyCode()
                    + ", routingKey=" + returned.getRoutingKey());
        }
        LOG.info("dispatched replay processing job {} as attempt {} (broker confirmed)",
                command.jobId(), command.attempt());
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

    /** Waits for the correlated publisher confirm; every non-success outcome fails closed. */
    private CorrelationData.Confirm awaitConfirm(final CorrelationData correlation, final String jobId) {
        try {
            return correlation.getFuture().get(confirmTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (final InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ParserDispatchException(
                    "interrupted while awaiting broker confirmation for job " + jobId, interrupted);
        } catch (final TimeoutException timeout) {
            throw new ParserDispatchException("broker confirmation timed out after " + confirmTimeout
                    + " for job " + jobId, timeout);
        } catch (final ExecutionException failure) {
            throw new ParserDispatchException("broker confirmation failed for job " + jobId,
                    failure.getCause() == null ? failure : failure.getCause());
        }
    }

    /**
     * Fail-closed constructor guard: without correlated confirms and publisher returns on the
     * connection factory, {@link #submit} could not honour its delivery invariant, so the adapter
     * refuses to exist rather than degrade into fire-and-forget publishing.
     */
    private static void requireConfirmedDelivery(final RabbitTemplate template) {
        final ConnectionFactory connectionFactory = template.getConnectionFactory();
        if (!(connectionFactory instanceof CachingConnectionFactory caching)) {
            throw new IllegalStateException("parser dispatch requires a CachingConnectionFactory "
                    + "with correlated publisher confirms and publisher returns, got "
                    + (connectionFactory == null ? "none" : connectionFactory.getClass().getName()));
        }
        // 只有 correlated confirms 才能按发布逐条等待确认；simple 模式无法与本次发布对应。
        if (!caching.isPublisherConfirms() || caching.isSimplePublisherConfirms()) {
            throw new IllegalStateException("parser dispatch requires correlated publisher confirms "
                    + "(ConfirmType.CORRELATED); simple or disabled confirms cannot be awaited per publish");
        }
        if (!caching.isPublisherReturns()) {
            throw new IllegalStateException("parser dispatch requires publisher returns "
                    + "(mandatory) so unroutable parser.request messages fail closed");
        }
        // mandatory 是 unroutable 检测的前提；由适配器强制开启，避免调用方漏配后静默丢消息。
        template.setMandatory(true);
    }

    private static Duration requirePositive(final String name, final Duration value) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be a positive duration");
        }
        return value;
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
