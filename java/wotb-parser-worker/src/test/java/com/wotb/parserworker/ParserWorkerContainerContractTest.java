package com.wotb.parserworker;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserTopology;
import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import com.wotb.parserworker.worker.ParserRequestHandler;
import com.wotb.parserworker.worker.ParserRequestListener;
import com.wotb.parserworker.worker.RabbitParserOutcomePublisher;
import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;

/**
 * Container wiring contract of the Yecao parser worker.
 *
 * <p>No broker and no container runtime here: this pins what the assembly is responsible for and
 * that its budgets are validated. The concurrency model itself is proved against a real broker by
 * {@code ParserWorkerPipelineTest#theContainerRunsTheConfiguredNumberOfConsumers}, because the
 * number of consumers is what makes two replays parse at the same time — a larger prefetch on a
 * single consumer does not.</p>
 */
class ParserWorkerContainerContractTest {

    private static final ParserWorkerProperties PROPERTIES = new ParserWorkerProperties(2, 1, 10, 30);

    @Test
    void theContainerConsumesTheWorkQueueWithManualAckAndTheWorkerListener() {
        final SimpleMessageListenerContainer container = container(PROPERTIES);
        assertArrayEquals(new String[]{ParserTopology.PARSER_QUEUE}, container.getQueueNames(),
                "the worker consumes the work queue only: never the retry queue, never the DLQ");
        assertEquals(AcknowledgeMode.MANUAL, container.getAcknowledgeMode(),
                "an outcome must be published and confirmed before the request is acknowledged");
        assertInstanceOf(ParserRequestListener.class, container.getMessageListener());
        assertFalse(container.isRunning(), "the bean must not start before the context lifecycle does");
    }

    @Test
    void propertiesRejectBudgetsThatCannotBeHonoured() {
        assertThrows(IllegalArgumentException.class, () -> new ParserWorkerProperties(0, 1, 10, 30));
        assertThrows(IllegalArgumentException.class, () -> new ParserWorkerProperties(2, 0, 10, 30));
        assertThrows(IllegalArgumentException.class, () -> new ParserWorkerProperties(2, 1, 0, 30));
        assertThrows(IllegalArgumentException.class, () -> new ParserWorkerProperties(2, 1, 10, 0));
    }

    @Test
    void propertiesExposeTheReviewedDefaults() {
        final ParserWorkerProperties defaults = new ParserWorkerAssembly().parserWorkerProperties();
        assertEquals(2, defaults.concurrency(), "two replays parse in parallel, matching REPLAY_PARSE_MAX_CONCURRENT");
        assertEquals(1, defaults.prefetch(),
                "prefetch is the per-consumer backlog, deliberately small so a crash redelivers quickly");
    }

    private static SimpleMessageListenerContainer container(final ParserWorkerProperties properties) {
        final CachingConnectionFactory factory = new CachingConnectionFactory("localhost");
        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        factory.setPublisherReturns(true);
        final ParserMessageCodec codec = new ParserMessageCodec();
        final RabbitParserOutcomePublisher publisher =
                new RabbitParserOutcomePublisher(new RabbitTemplate(factory), codec, Duration.ofSeconds(5));
        final ParserRequestHandler handler = new ParserRequestHandler(new UnusedStorage(),
                new DefaultReplayProcessingFacade(), new NoopLifecycle(), publisher, null);
        return new ParserWorkerAssembly().parserRequestListenerContainer(factory, codec, handler, properties);
    }

    /** Never reached: this test only builds the container, it never consumes a request. */
    private static final class UnusedStorage implements ObjectStorage {

        @Override
        public void put(final ObjectKey key, final InputStream content, final long contentLength,
                        final String contentType) throws IOException {
            throw new IOException("not used by the wiring contract");
        }

        @Override
        public InputStream get(final ObjectKey key) throws IOException {
            throw new IOException("not used by the wiring contract");
        }

        @Override
        public boolean exists(final ObjectKey key) throws IOException {
            throw new IOException("not used by the wiring contract");
        }

        @Override
        public void delete(final ObjectKey key) throws IOException {
            throw new IOException("not used by the wiring contract");
        }
    }

    private static final class NoopLifecycle implements ReplayProcessingLifecycle {

        @Override
        public void jobStarted(final String jobId) {
        }

        @Override
        public void sourceStarted(final String jobId, final int sourceIndex, final String sourceName) {
        }

        @Override
        public void sourceCompleted(final ReplayProcessingSourceOutcome outcome) {
        }

        @Override
        public void jobCompleted(final String jobId) {
        }
    }
}
