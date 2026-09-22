package com.wotb.parserworker;

import com.rabbitmq.client.ConnectionFactory;
import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserTopology;
import com.wotb.broker.rabbitmq.RabbitBrokerProperties;
import com.wotb.contracts.ObjectStorage;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import com.wotb.parserworker.worker.ParserRequestHandler;
import com.wotb.parserworker.worker.ParserRequestListener;
import com.wotb.parserworker.worker.RabbitParserOutcomePublisher;
import com.wotb.storage.MinioObjectStorage;
import com.wotb.storage.MinioObjectStorageProperties;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.Objects;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the worker's single execution path. Every collaborator is constructor-injected; this class
 * declares no topology (that stays with {@code infra/tofu/rabbitmq}) and no HTTP endpoint.
 *
 * <p>External configuration is bound by {@link ParserWorkerConfig}: this class consumes the resulting
 * immutable property objects and never constructs them from placeholder values. A {@code @Bean} method
 * annotated with {@code @ConfigurationProperties} would silently bind nothing on a record (no setters),
 * which is exactly how the worker shipped with blank credentials.</p>
 *
 * <p>The connection factory enables correlated publisher confirms and publisher returns, which
 * {@link RabbitParserOutcomePublisher} verifies in its constructor: without them the adapter refuses
 * to assemble rather than silently degrading to fire-and-forget publishing.</p>
 */
@Configuration
public class ParserWorkerAssembly {

    /**
     * Execution-plane lifecycle. The worker is stateless — PostgreSQL remains the authority for job
     * state — so lifecycle callbacks are deliberately no-ops here instead of being republished as
     * in-process application events.
     */
    @Bean
    ReplayProcessingLifecycle parserWorkerLifecycle() {
        return new ReplayProcessingLifecycle() {
            @Override
            public void jobStarted(final String jobId) {
                // No job-level state in the worker.
            }

            @Override
            public void sourceStarted(final String jobId, final int sourceIndex, final String sourceName) {
                // No per-source state in the worker.
            }

            @Override
            public void sourceCompleted(final ReplayProcessingSourceOutcome outcome) {
                // No per-source state in the worker.
            }

            @Override
            public void jobCompleted(final String jobId) {
                // No job-level state in the worker.
            }
        };
    }

    @Bean
    ParserMessageCodec parserMessageCodec() {
        return new ParserMessageCodec();
    }

    @Bean
    ObjectStorage parserWorkerObjectStorage(final MinioObjectStorageProperties properties) {
        return new MinioObjectStorage(properties);
    }

    @Bean
    DefaultReplayProcessingFacade replayProcessingFacade() {
        return new DefaultReplayProcessingFacade();
    }

    @Bean
    CachingConnectionFactory parserWorkerConnectionFactory(final RabbitBrokerProperties properties) {
        final ConnectionFactory factory = new ConnectionFactory();
        factory.setHost(properties.host());
        factory.setPort(properties.port());
        factory.setVirtualHost(properties.vhost());
        factory.setUsername(properties.username());
        factory.setPassword(properties.password());
        final CachingConnectionFactory caching =
                new CachingConnectionFactory(Objects.requireNonNull(factory));
        caching.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        caching.setPublisherReturns(true);
        return caching;
    }

    @Bean
    RabbitTemplate parserWorkerRabbitTemplate(
            final CachingConnectionFactory parserWorkerConnectionFactory) {
        return new RabbitTemplate(parserWorkerConnectionFactory);
    }

    @Bean
    RabbitParserOutcomePublisher parserOutcomePublisher(
            final RabbitTemplate parserWorkerRabbitTemplate,
            final ParserMessageCodec parserMessageCodec,
            final ParserWorkerProperties properties) {
        return new RabbitParserOutcomePublisher(parserWorkerRabbitTemplate, parserMessageCodec,
                Duration.ofSeconds(properties.confirmTimeoutSeconds()));
    }

    @Bean
    ParserRequestHandler parserRequestHandler(
            final ObjectStorage parserWorkerObjectStorage,
            final DefaultReplayProcessingFacade replayProcessingFacade,
            final ReplayProcessingLifecycle parserWorkerLifecycle,
            final RabbitParserOutcomePublisher parserOutcomePublisher,
            @Autowired(required = false) final MeterRegistry meterRegistry) {
        return new ParserRequestHandler(parserWorkerObjectStorage, replayProcessingFacade,
                parserWorkerLifecycle, parserOutcomePublisher, meterRegistry);
    }

    @Bean
    SimpleMessageListenerContainer parserRequestListenerContainer(
            final CachingConnectionFactory parserWorkerConnectionFactory,
            final ParserMessageCodec parserMessageCodec,
            final ParserRequestHandler parserRequestHandler,
            final ParserWorkerProperties properties) {
        final SimpleMessageListenerContainer container =
                new SimpleMessageListenerContainer(parserWorkerConnectionFactory);
        container.setQueueNames(ParserTopology.PARSER_QUEUE);
        container.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        // Concurrency is the number of consumers, not the prefetch: a single consumer holding two
        // unacked deliveries still parses one replay at a time. Both bounds are set so the intended
        // parallelism is exactly `concurrency` and cannot drift with load.
        container.setConcurrentConsumers(properties.concurrency());
        container.setMaxConcurrentConsumers(properties.concurrency());
        // Prefetch is the per-consumer backlog. Keep it small: an unacked delivery is work the
        // worker has promised to finish, and every extra one only lengthens the redelivery window
        // after a crash.
        container.setPrefetchCount(properties.prefetch());
        container.setDefaultRequeueRejected(false);
        container.setShutdownTimeout(properties.shutdownTimeoutSeconds() * 1000L);
        container.setMessageListener(new ParserRequestListener(parserMessageCodec, parserRequestHandler));
        return container;
    }
}
