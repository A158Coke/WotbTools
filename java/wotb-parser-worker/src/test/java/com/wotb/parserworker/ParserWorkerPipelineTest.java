package com.wotb.parserworker;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.rabbitmq.client.BuiltinExchangeType;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.wotb.broker.rabbitmq.ParserFailedMessage;
import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserRequestMessage;
import com.wotb.broker.rabbitmq.ParserRequestSource;
import com.wotb.broker.rabbitmq.ParserResultMessage;
import com.wotb.broker.rabbitmq.ParserSourceOutcome;
import com.wotb.broker.rabbitmq.ParserSourceStatus;
import com.wotb.broker.rabbitmq.ParserTopology;
import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import com.wotb.parserworker.worker.ParserOutcomePublishException;
import com.wotb.parserworker.worker.ParserRequestHandler;
import com.wotb.parserworker.worker.ParserRequestListener;
import com.wotb.parserworker.worker.ParserSourceDataset;
import com.wotb.parserworker.worker.RabbitParserOutcomePublisher;
import com.wotb.storage.MinioObjectStorage;
import com.wotb.storage.MinioObjectStorageProperties;
import com.wotb.storage.ObjectStorageKeys;
import com.wotb.web.replay.job.LocalReplayProcessingExecutor;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.testcontainers.containers.MinIOContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Real-container pipeline contract of the Yecao parser worker: one {@code parser.request} on a real
 * RabbitMQ, one replay in a real MinIO, one outcome on {@code wotb.parser.result}.
 *
 * <p>Production code declares no topology; this fixture declares the canonical names and arguments
 * (identical to {@code infra/tofu/rabbitmq}) so the worker can be driven on a real broker: consume
 * from {@code wotb.parser}, manual ack, confirm the published outcome, and never park a business
 * failure for an operator.</p>
 *
 * <p><b>Artifact single SSOT.</b> The same replay is processed twice — once through the local job
 * directory sink the TX control plane still uses, once through the worker's object-storage sink —
 * and every artifact is compared byte for byte. Identical bytes are what make the sink abstraction
 * safe: the worker cannot drift from the local pipeline it replaces.</p>
 */
@Testcontainers(disabledWithoutDocker = true)
class ParserWorkerPipelineTest {

    private static final String RABBITMQ_IMAGE = "rabbitmq:4.3.6-management-alpine";
    private static final String MINIO_IMAGE = "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z";
    private static final String ADMIN_USER = "ci-rabbitmq-admin";
    private static final String ADMIN_PASSWORD = "ci-rabbitmq-admin-password";
    private static final String MINIO_USER = "ci-minio-worker";
    private static final String MINIO_PASSWORD = "ci-minio-worker-password";
    private static final String BUCKET = "wotbtools-temp";
    /**
     * Fresh per test. MinIO objects are never purged between tests, so sharing one job id would let
     * one test observe another test's artifacts and make the assertions order-dependent.
     */
    private static String jobId;
    private static final String REPLAY_NAME = "random-battle-example.wotbreplay";

    /** Mirrors ParserWorkerAssembly: consumer concurrency and per-consumer prefetch. */
    private static final int WORKER_CONCURRENCY = 2;
    private static final int WORKER_PREFETCH = 1;

    private static final Duration SETTLE_TIMEOUT = Duration.ofSeconds(90);
    private static final long POLL_MILLIS = 100L;
    private static final Path SCHEMA_PATH = Path.of("..", "..", "contracts", "mq", "parser-messages.json");
    private static final Path FIXTURE_DIR =
            Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays");

    @Container
    private static final RabbitMQContainer BROKER =
            new RabbitMQContainer(DockerImageName.parse(RABBITMQ_IMAGE))
                    .withAdminUser(ADMIN_USER)
                    .withAdminPassword(ADMIN_PASSWORD)
                    .withRabbitMQConfig(MountableFile.forClasspathResource("rabbitmq-test.conf"));

    @Container
    private static final MinIOContainer MINIO =
            new MinIOContainer(DockerImageName.parse(MINIO_IMAGE).asCompatibleSubstituteFor("minio/minio"))
                    .withUserName(MINIO_USER)
                    .withPassword(MINIO_PASSWORD);

    private static final ParserMessageCodec CODEC = new ParserMessageCodec();
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static CachingConnectionFactory connectionFactory;
    private static RabbitTemplate template;
    private static RabbitAdmin admin;
    private static ObjectStorage storage;

    @BeforeAll
    static void prepareBrokerAndStorage() throws Exception {
        connectionFactory = new CachingConnectionFactory(BROKER.getHost(), BROKER.getAmqpPort());
        connectionFactory.setUsername(ADMIN_USER);
        connectionFactory.setPassword(ADMIN_PASSWORD);
        connectionFactory.setVirtualHost("/");
        // 与生产一致的投递语义：correlated publisher confirms + publisher returns，
        // 否则 RabbitParserOutcomePublisher 的 fail-closed 构造守卫会拒绝装配。
        connectionFactory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        connectionFactory.setPublisherReturns(true);
        template = new RabbitTemplate(connectionFactory);
        admin = new RabbitAdmin(connectionFactory);
        declareTopology();

        final String endpoint = MINIO.getS3URL().replaceFirst("^https?://", "");
        storage = new MinioObjectStorage(new MinioObjectStorageProperties(
                endpoint, BUCKET, MINIO_USER, MINIO_PASSWORD, 10, 60));
        try (MinioClient client = MinioClient.builder()
                .endpoint(MINIO.getS3URL())
                .credentials(MINIO_USER, MINIO_PASSWORD)
                .build()) {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(BUCKET).build())) {
                client.makeBucket(MakeBucketArgs.builder().bucket(BUCKET).build());
            }
        }
    }

    @AfterAll
    static void releaseConnections() {
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    /**
     * One isolated request per test: a fresh job id in object storage and four empty queues on the
     * broker. Without it a message a previous test left in the retry queue (its TTL is 30s) or an
     * artifact a previous test wrote would change what the next test observes.
     */
    @BeforeEach
    void isolateRequest() {
        jobId = UUID.randomUUID().toString();
        for (final String queue : List.of(ParserTopology.PARSER_QUEUE, ParserTopology.PARSER_RETRY_QUEUE,
                ParserTopology.PARSER_DLQ, ParserTopology.PARSER_RESULT_QUEUE)) {
            admin.purgeQueue(queue, true);
        }
    }

    @Test
    void requestIsParsedIntoByteIdenticalArtifactsAndAConfirmedResult() throws Exception {
        final byte[] replay = Files.readAllBytes(FIXTURE_DIR.resolve(REPLAY_NAME));

        // 1) Local path (existing job directory + file sink): the control-plane behaviour that must
        //    not change.
        final Path localJobDir = Files.createTempDirectory("parser-worker-parity");
        final Path localInput = localJobDir.resolve(jobId).resolve("input").resolve("0__" + REPLAY_NAME);
        Files.createDirectories(localInput.getParent());
        Files.write(localInput, replay);
        final RecordingLifecycle localLifecycle = new RecordingLifecycle();
        new LocalReplayProcessingExecutor(new DefaultReplayProcessingFacade(), localJobDir,
                localLifecycle, null).process(new ReplayProcessingRequest(
                        jobId, List.of(new ReplayProcessingSource(0, REPLAY_NAME))), 0);
        assertTrue(localLifecycle.lastOutcome.processedSuccessfully(),
                "the committed fixture must parse successfully through the canonical pipeline");

        // 2) Worker path: input in object storage, execution triggered by a real parser.request.
        put(ObjectStorageKeys.tempJobObject(jobId, "input/0/" + REPLAY_NAME), replay);
        final SimpleMessageListenerContainer container = listenerContainer();
        container.start();
        final ParserResultMessage result;
        try {
            dispatchRequest(1, REPLAY_NAME);
            final Message outcomeMessage = awaitOutcome(
                    ParserTopology.PARSER_RESULT_ROUTING_KEY, SETTLE_TIMEOUT);
            assertNotNull(outcomeMessage, "the worker must publish a parser.result for the request");
            assertMatchesSchemaRequired("result", outcomeMessage.getBody());
            result = CODEC.decodeResult(outcomeMessage.getBody());
            awaitQueueEmpty(ParserTopology.PARSER_QUEUE, "the acknowledged request leaving the work queue");
            assertQueueEmpty(ParserTopology.PARSER_DLQ);
        } finally {
            container.stop();
        }
        // Stopping the container requeues anything still unacknowledged, so an empty work queue with
        // no consumer left proves the request was acknowledged, not merely delivered.
        assertQueueEmpty(ParserTopology.PARSER_QUEUE);
        assertEquals(jobId, result.jobId());
        assertEquals(1, result.attempt());
        assertEquals(List.of(new ParserSourceOutcome(0, REPLAY_NAME, ParserSourceStatus.READY, null)),
                result.sources());

        // 3) Byte-for-byte parity of every artifact the request produced.
        for (final String artifact : List.of(
                ReplayArtifactWriter.AI_FACTS_NAME,
                ReplayArtifactWriter.MAP_OVERVIEW_NAME,
                ReplayArtifactWriter.BATTLE_PLAYBACK_V2_NAME)) {
            final Path localArtifact = localJobDir.resolve(jobId).resolve("derived").resolve("r0")
                    .resolve(artifact);
            final ObjectKey workerArtifact = ObjectStorageKeys.tempJobObject(
                    jobId, "artifacts/0/" + artifact);
            final boolean workerHasArtifact = storage.exists(workerArtifact);
            assertEquals(Files.exists(localArtifact), workerHasArtifact,
                    "both sinks must agree on whether " + artifact + " exists");
            if (workerHasArtifact) {
                assertArrayEquals(Files.readAllBytes(localArtifact), read(workerArtifact),
                        artifact + " must be byte-identical in both sinks");
            }
            if (ReplayArtifactWriter.AI_FACTS_NAME.equals(artifact)) {
                assertTrue(workerHasArtifact, "ai-facts.json is always written for a READY source");
            }
        }

        // 4) The canonical per-source dataset PR F reads.
        final ObjectKey datasetKey = ObjectStorageKeys.tempJobObject(jobId, "result/source-0.json");
        assertTrue(storage.exists(datasetKey), "the canonical dataset must be persisted");
        final JsonNode dataset = MAPPER.readTree(read(datasetKey));
        assertEquals(ParserSourceDataset.SCHEMA_VERSION, dataset.get("schemaVersion").asString());
        assertEquals(0, dataset.get("sourceIndex").asInt());
        assertEquals(REPLAY_NAME, dataset.get("sourceName").asString());
        assertEquals(1, dataset.get("battles").size(), "exactly one battle per READY source");
        assertEquals(List.of(REPLAY_NAME), stringList(dataset.get("battleSourceNames")));
        assertEquals(1, dataset.get("battleSourceIds").size());
        assertTrue(dataset.has("duplicates") && dataset.has("failures"));
        assertTrue(dataset.has("league") && dataset.has("leagueUnavailableCode"));
    }

    @Test
    void replayTheCanonicalParserRejectsIsReportedAsAFailedSourceAndAcked() throws Exception {
        final String invalidName = "not-a-replay.txt";
        put(ObjectStorageKeys.tempJobObject(jobId, "input/1/" + invalidName),
                "definitely not a replay".getBytes(StandardCharsets.UTF_8));

        final SimpleMessageListenerContainer container = listenerContainer();
        container.start();
        final ParserResultMessage result;
        try {
            dispatchRequest(1, 1, invalidName);
            final Message outcomeMessage = awaitOutcome(
                    ParserTopology.PARSER_RESULT_ROUTING_KEY, SETTLE_TIMEOUT);
            assertNotNull(outcomeMessage, "a rejected replay must still produce an outcome");
            assertMatchesSchemaRequired("result", outcomeMessage.getBody());
            result = CODEC.decodeResult(outcomeMessage.getBody());
            awaitQueueEmpty(ParserTopology.PARSER_QUEUE, "the acknowledged request leaving the work queue");
            assertQueueEmpty(ParserTopology.PARSER_DLQ);
            assertQueueEmpty(ParserTopology.PARSER_RETRY_QUEUE);
        } finally {
            container.stop();
        }
        // A business failure is terminal: nothing is left to retry once the consumer is gone.
        assertQueueEmpty(ParserTopology.PARSER_QUEUE);

        assertEquals(1, result.sources().size());
        final ParserSourceOutcome source = result.sources().getFirst();
        assertEquals(ParserSourceStatus.FAILED, source.status());
        assertEquals("FILE_VALIDATION_FAILED", source.errorCode());
        assertFalse(storage.exists(ObjectStorageKeys.tempJobObject(jobId, "result/source-1.json")),
                "a FAILED source must not publish a canonical dataset");
    }

    @Test
    void missingInputIsReportedAsARetryableFailureAndAcked() throws Exception {
        // No object exists for the requested source: the storage read fails, which is an
        // infrastructure failure, not a property of the replay bytes.
        final SimpleMessageListenerContainer container = listenerContainer();
        container.start();
        try {
            dispatchRequest(1, "absent.wotbreplay");
            final Message failed = awaitOutcome(ParserTopology.PARSER_FAILED_ROUTING_KEY, SETTLE_TIMEOUT);
            assertNotNull(failed, "an unreadable input must be reported as parser.failed");
            assertMatchesSchemaRequired("failed", failed.getBody());
            final ParserFailedMessage report = CODEC.decodeFailed(failed.getBody());
            assertEquals("PARSER_WORKER_STORAGE_UNAVAILABLE", report.errorCode());
            assertTrue(report.retryable(), "the control plane decides whether this attempt is retried");
            awaitQueueEmpty(ParserTopology.PARSER_QUEUE, "the reported request leaving the work queue");
        } finally {
            container.stop();
        }

        // The request is settled once its report is confirmed: the worker does not create a logical
        // retry, so nothing travels through the retry delay queue and nothing is parked.
        assertQueueEmpty(ParserTopology.PARSER_RETRY_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_DLQ);
        assertQueueEmpty(ParserTopology.PARSER_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_RESULT_QUEUE);
    }

    @Test
    void undecodableDeliveryIsParkedOnTheDlqInsteadOfSpinningInTheRetryLoop() throws Exception {
        // A body the codec refuses carries no jobId to report and can never succeed on redelivery,
        // so it is the one failure the worker may call terminal on its own.
        final byte[] undecodable = "not a parser request at all".getBytes(StandardCharsets.UTF_8);

        final SimpleMessageListenerContainer container = listenerContainer();
        container.start();
        try {
            template.send(ParserTopology.JOBS_EXCHANGE, ParserTopology.PARSER_REQUEST_ROUTING_KEY,
                    persistentJsonMessage(undecodable));
            final Message parked = awaitMessage(ParserTopology.PARSER_DLQ, SETTLE_TIMEOUT);
            assertNotNull(parked, "an undecodable delivery must be parked on the DLQ, not retried forever");
            assertEquals(ParserTopology.PARSER_DEAD_ROUTING_KEY,
                    parked.getMessageProperties().getReceivedRoutingKey());
            assertArrayEquals(undecodable, parked.getBody(),
                    "the parked delivery must keep the original bytes an operator has to diagnose");
            awaitQueueEmpty(ParserTopology.PARSER_QUEUE, "the parked delivery leaving the work queue");
        } finally {
            container.stop();
        }

        // Terminal means exactly that: no retry copy and no outcome report for a body nobody could
        // address, and nothing requeued when the consumer went away.
        assertQueueEmpty(ParserTopology.PARSER_RETRY_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_RESULT_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_QUEUE);
    }

    @Test
    void artifactWriteFailureIsReportedAsARetryableInfrastructureFailure() throws Exception {
        // The replay is readable and the canonical parse succeeds: only the artifact write fails.
        // That is infrastructure, not a property of the bytes, so it must leave through the retryable
        // parser.failed path instead of becoming a terminal per-source FAILED on parser.result.
        final byte[] replay = Files.readAllBytes(FIXTURE_DIR.resolve(REPLAY_NAME));
        put(ObjectStorageKeys.tempJobObject(jobId, "input/0/" + REPLAY_NAME), replay);

        final SimpleMessageListenerContainer container =
                listenerContainer(new UnwritableArtifactStorage(storage));
        container.start();
        try {
            dispatchRequest(1, REPLAY_NAME);
            final Message failed = awaitOutcome(ParserTopology.PARSER_FAILED_ROUTING_KEY, SETTLE_TIMEOUT);
            assertNotNull(failed, "an artifact write failure must be reported as parser.failed");
            assertMatchesSchemaRequired("failed", failed.getBody());
            final ParserFailedMessage report = CODEC.decodeFailed(failed.getBody());
            assertEquals("PARSER_WORKER_STORAGE_UNAVAILABLE", report.errorCode());
            assertTrue(report.retryable(), "a transient storage outage is retryable");
            // No terminal per-source verdict: the failure report is the only thing on the result path.
            assertQueueEmpty(ParserTopology.PARSER_RESULT_QUEUE);
            awaitQueueEmpty(ParserTopology.PARSER_QUEUE, "the reported request leaving the work queue");
        } finally {
            container.stop();
        }
        // The worker never creates a logical retry: retrying is a control-plane decision made from
        // parser.failed, so the delay queue stays empty and the request is not parked.
        assertQueueEmpty(ParserTopology.PARSER_RETRY_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_DLQ);
        assertQueueEmpty(ParserTopology.PARSER_QUEUE);
    }

    @Test
    void undeliveredFailureReportLeavesTheRequestUnacknowledgedAndRedeliveryKeepsTheAttempt() throws Exception {
        // The report itself cannot be published (broker confirm lost). Nothing may be acknowledged:
        // the transport has to redeliver the SAME attempt rather than the worker inventing a new one
        // or silently settling a job that no outcome will ever reach.
        final ParserRequestHandler undeliverable = new ParserRequestHandler(storage,
                new DefaultReplayProcessingFacade(), new RecordingLifecycle(),
                new RabbitParserOutcomePublisher(template, CODEC, Duration.ofSeconds(10)), null) {

            @Override
            public void publishFailed(final ParserRequestMessage request, final String errorCode,
                                      final boolean retryable) {
                throw new ParserOutcomePublishException("simulated lost broker confirm");
            }
        };
        final SimpleMessageListenerContainer container = listenerContainer(undeliverable);
        container.start();
        try {
            dispatchRequest(7, "absent.wotbreplay");
            // The consumer took the request, attempted the report and settled nothing.
            awaitQueueEmpty(ParserTopology.PARSER_QUEUE, "the request being taken by the consumer");
        } finally {
            container.stop();
        }
        // Stopping the consumer releases its unacknowledged delivery back to the work queue: had the
        // worker acknowledged it, there would be nothing left to redeliver.
        final Message redelivered = awaitMessage(ParserTopology.PARSER_QUEUE, SETTLE_TIMEOUT);
        assertNotNull(redelivered,
                "an unacknowledged request must come back to the work queue, not disappear");
        final ParserRequestMessage request = CODEC.decodeRequest(redelivered.getBody());
        assertEquals(7, request.attempt(), "transport redelivery must preserve the same attempt");
        assertEquals(jobId, request.jobId());
        assertQueueEmpty(ParserTopology.PARSER_RESULT_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_RETRY_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_DLQ);
    }

    @Test
    void theContainerRunsTheConfiguredNumberOfConsumers() throws Exception {
        final SimpleMessageListenerContainer container = listenerContainer();
        container.start();
        try {
            final long deadline = System.nanoTime() + SETTLE_TIMEOUT.toNanos();
            int consumers = 0;
            while (System.nanoTime() < deadline && consumers != WORKER_CONCURRENCY) {
                final var info = admin.getQueueInfo(ParserTopology.PARSER_QUEUE);
                consumers = info == null ? 0 : info.getConsumerCount();
                if (consumers != WORKER_CONCURRENCY) {
                    sleep();
                }
            }
            assertEquals(WORKER_CONCURRENCY, consumers,
                    "concurrency is the consumer count; a larger prefetch alone would still parse "
                            + "one replay at a time");
        } finally {
            container.stop();
        }
    }

    // ---- helpers -------------------------------------------------------------------------------

    private static SimpleMessageListenerContainer listenerContainer() {
        return listenerContainer(storage);
    }

    /**
     * The same wiring the production assembly uses: {@code WORKER_CONCURRENCY} consumers and one
     * unacked delivery per consumer. An artifact-sink failure needs its own storage, so the sink is
     * injectable here.
     */
    private static SimpleMessageListenerContainer listenerContainer(final ObjectStorage objectStorage) {
        final ParserRequestHandler handler = new ParserRequestHandler(objectStorage,
                new DefaultReplayProcessingFacade(), new RecordingLifecycle(),
                new RabbitParserOutcomePublisher(template, CODEC, Duration.ofSeconds(10)), null);
        return listenerContainer(handler);
    }

    private static SimpleMessageListenerContainer listenerContainer(final ParserRequestHandler handler) {
        final SimpleMessageListenerContainer container =
                new SimpleMessageListenerContainer(connectionFactory);
        container.setQueueNames(ParserTopology.PARSER_QUEUE);
        container.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        container.setConcurrentConsumers(WORKER_CONCURRENCY);
        container.setMaxConcurrentConsumers(WORKER_CONCURRENCY);
        container.setPrefetchCount(WORKER_PREFETCH);
        container.setDefaultRequeueRejected(false);
        container.setMessageListener(new ParserRequestListener(CODEC, handler));
        return container;
    }

    /** Publishes one request directly on the canonical exchange/routing key, from source index 0. */
    private static void dispatchRequest(final int attempt, final String... sourceNames) {
        dispatchRequest(attempt, 0, sourceNames);
    }

    /**
     * Publishes one request whose sources start at {@code firstSourceIndex}. The index has to match
     * the object the test stored, because the worker reads {@code input/<index>/<name>}.
     */
    private static void dispatchRequest(final int attempt, final int firstSourceIndex,
                                        final String... sourceNames) {
        final List<ParserRequestSource> sources = new ArrayList<>();
        for (int index = 0; index < sourceNames.length; index++) {
            sources.add(new ParserRequestSource(firstSourceIndex + index, sourceNames[index]));
        }
        final ParserRequestMessage request = new ParserRequestMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                UUID.randomUUID().toString(),
                jobId,
                attempt,
                Instant.now(),
                sources);
        template.send(ParserTopology.JOBS_EXCHANGE, ParserTopology.PARSER_REQUEST_ROUTING_KEY,
                persistentJsonMessage(CODEC.encode(request)));
    }

    private static Message persistentJsonMessage(final byte[] body) {
        final MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        return new Message(body, properties);
    }

    /**
     * Reads the first outcome off the result path and asserts it is the expected routing key. Not
     * filtering silently matters: a discarded report turns a real protocol violation into a
     * timeout, and the message is gone by then.
     */
    private static Message awaitOutcome(final String routingKey, final Duration timeout) {
        final long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            final Message message = template.receive(ParserTopology.PARSER_RESULT_QUEUE, 1_000);
            if (message == null) {
                continue;
            }
            assertEquals(routingKey, message.getMessageProperties().getReceivedRoutingKey(),
                    "the worker reported an unexpected outcome routing key");
            return message;
        }
        return null;
    }

    private static Message awaitMessage(final String queue, final Duration timeout) {
        final long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            final Message message = template.receive(queue, 1_000);
            if (message != null) {
                return message;
            }
        }
        return null;
    }

    /**
     * The ack is asynchronous relative to the published outcome, so the settled state is polled: a
     * request the worker acknowledged leaves the work queue and is not returned to it.
     */
    private static void awaitQueueEmpty(final String queue, final String description) {
        final long deadline = System.nanoTime() + SETTLE_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            final var info = admin.getQueueInfo(queue);
            if (info != null && info.getMessageCount() == 0 && info.getConsumerCount() > 0) {
                return;
            }
            sleep();
        }
        throw new AssertionError(queue + " never reported " + description);
    }

    private static void assertQueueEmpty(final String queue) {
        assertNull(template.receive(queue, 500), queue + " must have no ready message");
    }

    private static void sleep() {
        try {
            Thread.sleep(POLL_MILLIS);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while waiting for the broker", e);
        }
    }

    private static void put(final ObjectKey key, final byte[] content) throws Exception {
        storage.put(key, new ByteArrayInputStream(content), content.length, "application/octet-stream");
    }

    private static byte[] read(final ObjectKey key) throws Exception {
        try (InputStream stream = storage.get(key)) {
            return stream.readAllBytes();
        }
    }

    private static List<String> stringList(final JsonNode array) {
        final List<String> values = new ArrayList<>();
        for (final JsonNode node : array) {
            values.add(node.asString());
        }
        return values;
    }

    private static void assertMatchesSchemaRequired(final String definition, final byte[] body) {
        final JsonNode schema = MAPPER.readTree(SCHEMA_PATH);
        final JsonNode produced = MAPPER.readTree(body);
        final JsonNode required = schema.get("definitions").get(definition).get("required");
        assertNotNull(required, definition + " schema must declare required fields");
        assertFalse(required.isEmpty(), definition + " schema must declare required fields");
        for (final JsonNode field : required.values()) {
            assertTrue(produced.has(field.asString()),
                    definition + " envelope must carry " + field.asString());
        }
    }

    /**
     * Production code declares no topology; this fixture declares the canonical names and arguments
     * (identical to {@code infra/tofu/rabbitmq}) so the protocol can run on a real broker.
     */
    private static void declareTopology() throws Exception {
        try (Connection connection = rawConnectionFactory().newConnection();
                Channel channel = connection.createChannel()) {
            channel.exchangeDeclare(ParserTopology.JOBS_EXCHANGE, BuiltinExchangeType.TOPIC, true, false, null);
            channel.queueDeclare(ParserTopology.PARSER_QUEUE, true, false, false, Map.of(
                    "x-queue-type", "classic",
                    "x-dead-letter-exchange", ParserTopology.JOBS_EXCHANGE,
                    "x-dead-letter-routing-key", ParserTopology.PARSER_RETRY_ROUTING_KEY));
            channel.queueDeclare(ParserTopology.PARSER_RETRY_QUEUE, true, false, false, Map.of(
                    "x-queue-type", "classic",
                    "x-message-ttl", 30000,
                    "x-dead-letter-exchange", ParserTopology.JOBS_EXCHANGE,
                    "x-dead-letter-routing-key", ParserTopology.PARSER_REQUEST_ROUTING_KEY));
            channel.queueDeclare(ParserTopology.PARSER_DLQ, true, false, false, Map.of("x-queue-type", "classic"));
            channel.queueDeclare(ParserTopology.PARSER_RESULT_QUEUE, true, false, false, Map.of(
                    "x-queue-type", "classic",
                    "x-dead-letter-exchange", ParserTopology.JOBS_EXCHANGE,
                    "x-dead-letter-routing-key", ParserTopology.PARSER_DEAD_ROUTING_KEY));
            channel.queueBind(ParserTopology.PARSER_QUEUE, ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_REQUEST_ROUTING_KEY);
            channel.queueBind(ParserTopology.PARSER_RETRY_QUEUE, ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_RETRY_ROUTING_KEY);
            channel.queueBind(ParserTopology.PARSER_DLQ, ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_DEAD_ROUTING_KEY);
            channel.queueBind(ParserTopology.PARSER_RESULT_QUEUE, ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_RESULT_ROUTING_KEY);
            channel.queueBind(ParserTopology.PARSER_RESULT_QUEUE, ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_FAILED_ROUTING_KEY);
        }
    }

    private static ConnectionFactory rawConnectionFactory() {
        final ConnectionFactory factory = new ConnectionFactory();
        factory.setHost(BROKER.getHost());
        factory.setPort(BROKER.getAmqpPort());
        factory.setUsername(ADMIN_USER);
        factory.setPassword(ADMIN_PASSWORD);
        factory.setVirtualHost("/");
        return factory;
    }

    /**
     * Reads fine, fails every write: a storage outage that starts only once the replay has been read
     * and parsed, which is exactly the case the artifact-write classification has to get right.
     */
    private static final class UnwritableArtifactStorage implements ObjectStorage {

        private final ObjectStorage delegate;

        private UnwritableArtifactStorage(final ObjectStorage delegate) {
            this.delegate = delegate;
        }

        @Override
        public void put(final ObjectKey key, final InputStream content, final long contentLength,
                        final String contentType) throws IOException {
            throw new IOException("simulated object storage outage for " + key.value());
        }

        @Override
        public InputStream get(final ObjectKey key) throws IOException {
            return delegate.get(key);
        }

        @Override
        public boolean exists(final ObjectKey key) throws IOException {
            return delegate.exists(key);
        }
    }

    /** Records the last lifecycle outcome so the local path's success can be asserted. */
    private static final class RecordingLifecycle implements ReplayProcessingLifecycle {
        private ReplayProcessingSourceOutcome lastOutcome;

        @Override
        public void jobStarted(final String jobId) {
        }

        @Override
        public void sourceStarted(final String jobId, final int sourceIndex, final String sourceName) {
        }

        @Override
        public void sourceCompleted(final ReplayProcessingSourceOutcome outcome) {
            this.lastOutcome = outcome;
        }

        @Override
        public void jobCompleted(final String jobId) {
        }
    }
}
