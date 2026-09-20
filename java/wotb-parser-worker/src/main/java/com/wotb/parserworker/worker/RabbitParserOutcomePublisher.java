package com.wotb.parserworker.worker;

import com.wotb.broker.rabbitmq.ParserFailedMessage;
import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserResultMessage;
import com.wotb.broker.rabbitmq.ParserTopology;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Objects;
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
 * Publishes {@code parser.result} / {@code parser.failed} — and the {@code parser.dead} park for a
 * delivery the worker cannot decode — with <b>confirmed delivery</b>.
 *
 * <p>This is the worker's half of the PR C delivery invariant. A successful return means the broker
 * confirmed the publish <em>and</em> the message was routable; a lost publish, a broker NACK, a
 * confirm timeout, a connection failure or an unroutable routing key all surface as
 * {@link ParserOutcomePublishException}. The caller then rejects the delivered
 * {@code parser.request} without requeue, so "the result was never delivered" is discoverable in
 * the DLQ instead of silently hanging the job.</p>
 *
 * <p>The constructor fails closed unless the supplied {@link RabbitTemplate} actually has correlated
 * publisher confirms and publisher returns on its connection factory, and {@code mandatory} is
 * forced on so the unroutable path is always active. Like the dispatcher, this class declares no
 * Spring stereotype and no topology.</p>
 */
public class RabbitParserOutcomePublisher {

    private static final Logger LOG = LoggerFactory.getLogger(RabbitParserOutcomePublisher.class);

    private final RabbitTemplate template;
    private final ParserMessageCodec codec;
    private final Duration confirmTimeout;

    public RabbitParserOutcomePublisher(final RabbitTemplate template,
                                        final ParserMessageCodec codec,
                                        final Duration confirmTimeout) {
        this.template = Objects.requireNonNull(template, "template");
        this.codec = Objects.requireNonNull(codec, "codec");
        if (confirmTimeout == null || confirmTimeout.isZero() || confirmTimeout.isNegative()) {
            throw new IllegalArgumentException("confirmTimeout must be a positive duration");
        }
        this.confirmTimeout = confirmTimeout;
        requireConfirmedDelivery(template);
    }

    /** Publishes one {@code parser.result} envelope and waits for the broker confirm. */
    public void publishResult(final ParserResultMessage message) {
        final ParserResultMessage envelope = Objects.requireNonNull(message, "message");
        publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, envelope.eventId(),
                codec.encode(envelope), envelope.jobId());
    }

    /** The correlated-confirm bound every publish waits for. */
    public Duration confirmTimeout() {
        return confirmTimeout;
    }

    /** Publishes one {@code parser.failed} envelope and waits for the broker confirm. */
    public void publishFailed(final ParserFailedMessage message) {
        final ParserFailedMessage envelope = Objects.requireNonNull(message, "message");
        publish(ParserTopology.PARSER_FAILED_ROUTING_KEY, envelope.eventId(),
                codec.encode(envelope), envelope.jobId());
    }

    /**
     * Parks a delivery the worker cannot decode on the DLQ path ({@code parser.dead}).
     *
     * <p>The body is forwarded <em>verbatim</em>. An undecodable delivery carries no {@code jobId}
     * and no {@code attempt}, so there is no {@code parser.failed} envelope to publish: the original
     * bytes <em>are</em> the diagnosis an operator needs. Confirmed delivery applies here too, so a
     * park that never reached the DLQ is reported as a failure instead of being mistaken for a
     * parked terminal failure.</p>
     */
    public void parkTerminal(final byte[] body) {
        final byte[] payload = Objects.requireNonNull(body, "body");
        publish(ParserTopology.PARSER_DEAD_ROUTING_KEY, null, payload, "<undecodable request>");
    }

    private void publish(final String routingKey, final String eventId, final byte[] body, final String jobId) {
        final CorrelationData correlation = new CorrelationData(eventId == null ? UUID.randomUUID().toString() : eventId);
        try {
            template.send(ParserTopology.JOBS_EXCHANGE, routingKey, persistentJsonMessage(body), correlation);
        } catch (final RuntimeException publishFailure) {
            throw new ParserOutcomePublishException(
                    routingKey + " publish failed for job " + jobId, publishFailure);
        }
        final CorrelationData.Confirm confirm = awaitConfirm(correlation, routingKey, jobId);
        if (!confirm.isAck()) {
            throw new ParserOutcomePublishException("broker nacked " + routingKey + " for job "
                    + jobId + ": " + confirm.getReason());
        }
        final ReturnedMessage returned = correlation.getReturned();
        if (returned != null) {
            throw new ParserOutcomePublishException(routingKey + " for job " + jobId
                    + " was unroutable: replyCode=" + returned.getReplyCode()
                    + ", routingKey=" + returned.getRoutingKey());
        }
        LOG.info("published {} for job {} (broker confirmed)", routingKey, jobId);
    }

    private CorrelationData.Confirm awaitConfirm(final CorrelationData correlation,
                                                 final String routingKey,
                                                 final String jobId) {
        try {
            return correlation.getFuture().get(confirmTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (final InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ParserOutcomePublishException(
                    "interrupted while awaiting broker confirmation for " + routingKey + " job " + jobId,
                    interrupted);
        } catch (final TimeoutException timeout) {
            throw new ParserOutcomePublishException("broker confirmation timed out after "
                    + confirmTimeout + " for " + routingKey + " job " + jobId, timeout);
        } catch (final ExecutionException failure) {
            throw new ParserOutcomePublishException("broker confirmation failed for " + routingKey
                    + " job " + jobId, failure.getCause() == null ? failure : failure.getCause());
        }
    }

    /**
     * Fail-closed guard: without correlated confirms and publisher returns the adapter could not
     * honour the delivery invariant, so it refuses to exist instead of degrading into
     * fire-and-forget publishing.
     */
    private static void requireConfirmedDelivery(final RabbitTemplate template) {
        final ConnectionFactory connectionFactory = template.getConnectionFactory();
        if (!(connectionFactory instanceof CachingConnectionFactory caching)) {
            throw new IllegalStateException("parser outcome publish requires a CachingConnectionFactory "
                    + "with correlated publisher confirms and publisher returns, got "
                    + (connectionFactory == null ? "none" : connectionFactory.getClass().getName()));
        }
        if (!caching.isPublisherConfirms() || caching.isSimplePublisherConfirms()) {
            throw new IllegalStateException("parser outcome publish requires correlated publisher confirms "
                    + "(ConfirmType.CORRELATED); simple or disabled confirms cannot be awaited per publish");
        }
        if (!caching.isPublisherReturns()) {
            throw new IllegalStateException("parser outcome publish requires publisher returns "
                    + "(mandatory) so unroutable outcomes fail closed");
        }
        template.setMandatory(true);
    }

    private static Message persistentJsonMessage(final byte[] body) {
        final MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setContentEncoding(StandardCharsets.UTF_8.name());
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        return new Message(body, properties);
    }
}
