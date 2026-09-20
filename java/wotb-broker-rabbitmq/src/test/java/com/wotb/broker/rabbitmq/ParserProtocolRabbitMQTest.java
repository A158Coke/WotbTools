package com.wotb.broker.rabbitmq;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.rabbitmq.client.BuiltinExchangeType;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.GetResponse;
import com.wotb.contracts.ReplayProcessingDispatcher.CancellationResult;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Predicate;
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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Real-broker contract of the bidirectional parser protocol.
 *
 * <p>Production code declares no topology; this fixture declares the canonical names and arguments
 * (identical to {@code infra/tofu/rabbitmq}) so the protocol can be driven on a real broker:
 * dispatch, manual ack, duplicate and stale tolerance, dead-lettering of both handler failures and
 * undecodable bodies, and the retry link. The image is pinned to the production RabbitMQ release
 * with the management plugin enabled, because the unacknowledged-count assertions read the
 * Management API.</p>
 */
@Testcontainers(disabledWithoutDocker = true)
class ParserProtocolRabbitMQTest {

    private static final String RABBITMQ_IMAGE = "rabbitmq:4.3.6-management-alpine";
    private static final String ADMIN_USER = "ci-rabbitmq-admin";
    private static final String ADMIN_PASSWORD = "ci-rabbitmq-admin-password";
    private static final String JOB_ID = "0f9c2f4e-1e6a-4d0c-9f2b-7d3a5c1b8e21";
    private static final Path SCHEMA_PATH = Path.of("..", "..", "contracts", "mq", "parser-messages.json");
    private static final Duration SETTLE_TIMEOUT = Duration.ofSeconds(25);
    private static final long POLL_MILLIS = 100L;

    @Container
    private static final RabbitMQContainer BROKER =
            new RabbitMQContainer(DockerImageName.parse(RABBITMQ_IMAGE))
                    .withAdminUser(ADMIN_USER)
                    .withAdminPassword(ADMIN_PASSWORD)
                    .withRabbitMQConfig(MountableFile.forClasspathResource("rabbitmq-test.conf"));

    private static final ParserMessageCodec CODEC = new ParserMessageCodec();

    /**
     * The Management API is HTTP/1.1 only; the JDK client's default HTTP/2 upgrade attempt ends in a
     * dropped connection, so the version is pinned here instead of left to the client default.
     */
    private static final HttpClient HTTP =
            HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();

    private static CachingConnectionFactory connectionFactory;
    private static RabbitTemplate template;
    private static RabbitAdmin admin;

    @BeforeAll
    static void declareCanonicalTopology() throws Exception {
        connectionFactory = new CachingConnectionFactory(BROKER.getHost(), BROKER.getAmqpPort());
        connectionFactory.setUsername(ADMIN_USER);
        connectionFactory.setPassword(ADMIN_PASSWORD);
        connectionFactory.setVirtualHost("/");
        template = new RabbitTemplate(connectionFactory);
        admin = new RabbitAdmin(connectionFactory);
        awaitManagementApi();
        declareTopology();
    }

    @AfterAll
    static void releaseConnections() {
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    @BeforeEach
    void purgeCanonicalQueues() {
        drainCanonicalQueues();
    }

    /**
     * Every test shares one static broker. A delivery a stopped listener container left
     * unacknowledged goes back to the queue only once its channel closes, and that settling can
     * land after the next test has started â€” so each test drains the canonical queues first and
     * never inherits the previous test's leftovers. Purging removes ready and unacknowledged
     * messages alike.
     */
    private static void drainCanonicalQueues() {
        for (final String queue : List.of(
                ParserTopology.PARSER_QUEUE,
                ParserTopology.PARSER_RETRY_QUEUE,
                ParserTopology.PARSER_DLQ,
                ParserTopology.PARSER_RESULT_QUEUE)) {
            admin.purgeQueue(queue);
        }
    }

    @Test
    void submittedRequestArrivesAsTheSchemaEnvelopeInTheParserQueue() {
        dispatcher().submit(new ReplayProcessingRequest(
                JOB_ID,
                List.of(new ReplayProcessingSource(0, "a.wotbreplay"), new ReplayProcessingSource(1, "b.wotbreplay"))));

        final Message message = receiveFrom(ParserTopology.PARSER_QUEUE);
        assertNotNull(message, "the dispatched request must reach " + ParserTopology.PARSER_QUEUE);
        final MessageProperties properties = message.getMessageProperties();
        assertEquals(ParserTopology.PARSER_REQUEST_ROUTING_KEY, properties.getReceivedRoutingKey());
        assertEquals(ParserTopology.JOBS_EXCHANGE, properties.getReceivedExchange());
        assertEquals(MessageDeliveryMode.PERSISTENT, properties.getReceivedDeliveryMode());

        assertMatchesSchemaRequired("request", message.getBody());
        final ParserRequestMessage decoded = CODEC.decodeRequest(message.getBody());
        assertEquals(ParserMessageCodec.SCHEMA_VERSION, decoded.schemaVersion());
        assertEquals(JOB_ID, decoded.jobId());
        assertEquals(1, decoded.attempt());
        assertNotNull(decoded.eventId());
        assertNotNull(decoded.createdAt());
        assertEquals(
                List.of(new ParserRequestSource(0, "a.wotbreplay"), new ParserRequestSource(1, "b.wotbreplay")),
                decoded.sources());
    }

    @Test
    void manualAckWaitsForTheHandlerToFinish() throws Exception {
        final CountDownLatch handlerEntered = new CountDownLatch(1);
        final CountDownLatch releaseHandler = new CountDownLatch(1);
        final SimpleMessageListenerContainer container = listenerContainer(new ParserOutcomeHandler() {
            @Override
            public Outcome handleResult(final ParserResultMessage message) {
                handlerEntered.countDown();
                awaitQuietly(releaseHandler);
                return Outcome.APPLIED;
            }

            @Override
            public Outcome handleFailed(final ParserFailedMessage message) {
                throw new UnsupportedOperationException("no failed envelope expected");
            }
        });
        container.start();
        try {
            publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, CODEC.encode(resultEnvelope("manual-ack", 1)));
            assertTrue(handlerEntered.await(20, TimeUnit.SECONDS), "the handler must receive the outcome");

            // While the handler is blocked the delivery must still be unacknowledged on the broker.
            awaitStats(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    "an unacknowledged delivery",
                    stats -> counterIsAtLeast(stats, "messages_unacknowledged", 1));

            releaseHandler.countDown();
            // The ack is what the broker must observe: nothing ready and nothing unacknowledged
            // for this delivery. `messages` alone would also count a delivery another test's
            // still-closing channel has not released yet, so both counters are checked directly.
            awaitStats(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    "the released delivery acknowledged",
                    ParserProtocolRabbitMQTest::isFullySettled);
            assertQueueEmpty(ParserTopology.PARSER_DLQ);
        } finally {
            releaseHandler.countDown();
            container.stop();
            // Leave the shared broker as this test found it: the next test drains as well, but a
            // delivery this container abandoned must not depend on that.
            drainCanonicalQueues();
        }
    }

    @Test
    void duplicateDeliveryIsAppliedTwiceAndAckedWithoutDlq() throws Exception {
        final CountDownLatch handledTwice = new CountDownLatch(2);
        final List<String> eventIds = Collections.synchronizedList(new ArrayList<>());
        final SimpleMessageListenerContainer container = listenerContainer(new ParserOutcomeHandler() {
            @Override
            public Outcome handleResult(final ParserResultMessage message) {
                eventIds.add(message.eventId());
                handledTwice.countDown();
                return Outcome.APPLIED;
            }

            @Override
            public Outcome handleFailed(final ParserFailedMessage message) {
                throw new UnsupportedOperationException("no failed envelope expected");
            }
        });
        container.start();
        try {
            final byte[] body = CODEC.encode(resultEnvelope("duplicate-1", 1));
            publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, body);
            publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, body);

            assertTrue(handledTwice.await(20, TimeUnit.SECONDS), "the same envelope must be delivered twice");
            assertEquals(List.of("duplicate-1", "duplicate-1"), eventIds);
            awaitStats(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    "both deliveries acknowledged",
                    ParserProtocolRabbitMQTest::isFullySettled);
            assertQueueEmpty(ParserTopology.PARSER_DLQ);
        } finally {
            container.stop();
        }
    }

    @Test
    void staleAttemptIsAcknowledgedWithoutDlq() throws Exception {
        final int currentAttempt = 2;
        final CountDownLatch handled = new CountDownLatch(1);
        final AtomicInteger reportedAttempt = new AtomicInteger();
        final SimpleMessageListenerContainer container = listenerContainer(new ParserOutcomeHandler() {
            @Override
            public Outcome handleResult(final ParserResultMessage message) {
                reportedAttempt.set(message.attempt());
                handled.countDown();
                return message.attempt() < currentAttempt ? Outcome.IGNORED_STALE_OR_DUPLICATE : Outcome.APPLIED;
            }

            @Override
            public Outcome handleFailed(final ParserFailedMessage message) {
                throw new UnsupportedOperationException("no failed envelope expected");
            }
        });
        container.start();
        try {
            publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, CODEC.encode(resultEnvelope("stale-1", 1)));

            assertTrue(handled.await(20, TimeUnit.SECONDS), "the stale outcome must still reach the handler");
            assertEquals(1, reportedAttempt.get());
            awaitStats(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    "the ignored stale outcome acknowledged",
                    ParserProtocolRabbitMQTest::isFullySettled);
            assertQueueEmpty(ParserTopology.PARSER_DLQ);
        } finally {
            container.stop();
        }
    }

    @Test
    void failedHandlerDeadLettersTheOutcomeToTheDlq() throws Exception {
        final CountDownLatch handled = new CountDownLatch(1);
        final SimpleMessageListenerContainer container = listenerContainer(new ParserOutcomeHandler() {
            @Override
            public Outcome handleResult(final ParserResultMessage message) {
                handled.countDown();
                throw new IllegalStateException("authoritative job state is unavailable");
            }

            @Override
            public Outcome handleFailed(final ParserFailedMessage message) {
                throw new UnsupportedOperationException("no failed envelope expected");
            }
        });
        container.start();
        try {
            publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, CODEC.encode(resultEnvelope("dead-letter-1", 1)));

            assertTrue(handled.await(20, TimeUnit.SECONDS), "the failing handler must be invoked");
            final Message dead = receiveFrom(ParserTopology.PARSER_DLQ);
            assertNotNull(dead, "the failed outcome must reach " + ParserTopology.PARSER_DLQ);
            assertEquals(ParserTopology.PARSER_DEAD_ROUTING_KEY, dead.getMessageProperties().getReceivedRoutingKey());
            assertEquals("dead-letter-1", CODEC.decodeResult(dead.getBody()).eventId());
            awaitStats(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    "the rejected outcome leaving the result queue",
                    ParserProtocolRabbitMQTest::isFullySettled);
        } finally {
            container.stop();
        }
    }

    @Test
    void undecodableOutcomesAreDeadLetteredWithoutReachingTheHandler() throws Exception {
        final AtomicInteger handlerCalls = new AtomicInteger();
        final SimpleMessageListenerContainer container = listenerContainer(new ParserOutcomeHandler() {
            @Override
            public Outcome handleResult(final ParserResultMessage message) {
                handlerCalls.incrementAndGet();
                return Outcome.APPLIED;
            }

            @Override
            public Outcome handleFailed(final ParserFailedMessage message) {
                handlerCalls.incrementAndGet();
                return Outcome.APPLIED;
            }
        });
        container.start();
        try {
            final byte[] unknownVersion = ("{\"schemaVersion\":\"2\",\"eventId\":\"event-9\",\"jobId\":\"" + JOB_ID
                    + "\",\"attempt\":1,\"occurredAt\":\"2026-01-01T00:00:00Z\",\"sources\":[]}")
                    .getBytes(StandardCharsets.UTF_8);
            publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, unknownVersion);
            publish(ParserTopology.PARSER_RESULT_ROUTING_KEY, "not-json".getBytes(StandardCharsets.UTF_8));

            final Message firstDead = receiveFrom(ParserTopology.PARSER_DLQ);
            assertNotNull(firstDead, "an unknown schemaVersion must be dead-lettered");
            final Message secondDead = receiveFrom(ParserTopology.PARSER_DLQ);
            assertNotNull(secondDead, "a non-JSON body must be dead-lettered");
            assertEquals(ParserTopology.PARSER_DEAD_ROUTING_KEY, firstDead.getMessageProperties().getReceivedRoutingKey());
            assertEquals(ParserTopology.PARSER_DEAD_ROUTING_KEY, secondDead.getMessageProperties().getReceivedRoutingKey());

            // Fail closed keeps the identity for the operator log even though the body is rejected.
            final ParserMessageCodecException failure =
                    assertThrows(ParserMessageCodecException.class, () -> CODEC.decodeResult(unknownVersion));
            assertEquals(JOB_ID, failure.jobId().orElse(null));
            assertEquals("event-9", failure.eventId().orElse(null));

            assertEquals(0, handlerCalls.get(), "an undecodable body must never reach the handler");
            awaitStats(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    "both undecodable outcomes leaving the result queue",
                    ParserProtocolRabbitMQTest::isFullySettled);
        } finally {
            container.stop();
        }
    }

    @Test
    void rejectedRequestTravelsThroughTheRetryQueueInsteadOfStayingQueued() throws Exception {
        dispatcher().submit(new ReplayProcessingRequest(JOB_ID, List.of(new ReplayProcessingSource(0, "a.wotbreplay"))));

        try (Connection connection = rawConnectionFactory().newConnection();
                Channel channel = connection.createChannel()) {
            final GetResponse reservation = pollGet(channel, ParserTopology.PARSER_QUEUE);
            assertNotNull(reservation, "the dispatched request must reach " + ParserTopology.PARSER_QUEUE);
            assertEquals(ParserTopology.PARSER_REQUEST_ROUTING_KEY, reservation.getEnvelope().getRoutingKey());
            channel.basicNack(reservation.getEnvelope().getDeliveryTag(), false, false);
        }

        final Message retried = receiveFrom(ParserTopology.PARSER_RETRY_QUEUE);
        assertNotNull(retried, "the rejected request must reach " + ParserTopology.PARSER_RETRY_QUEUE);
        assertEquals(ParserTopology.PARSER_RETRY_ROUTING_KEY, retried.getMessageProperties().getReceivedRoutingKey());
        @SuppressWarnings("unchecked")
        final List<Map<String, Object>> deaths =
                (List<Map<String, Object>>) retried.getMessageProperties().getHeaders().get("x-death");
        assertNotNull(deaths, "the retry hop must record its x-death header");
        assertEquals(ParserTopology.PARSER_QUEUE, deaths.get(0).get("queue"));
        assertEquals("rejected", deaths.get(0).get("reason"));
        assertEquals(JOB_ID, CODEC.decodeRequest(retried.getBody()).jobId());

        // The retry queue holds the message for its TTL; it must no longer sit in the work queue,
        // and reading it out here keeps the 30s TTL from re-routing it into a later test.
        assertQueueEmpty(ParserTopology.PARSER_QUEUE);
    }

    @Test
    void queuedCancellationIsReportedAsActiveCompletionPendingWithoutPublishing() {
        assertEquals(CancellationResult.ACTIVE_COMPLETION_PENDING, dispatcher().cancelQueued(JOB_ID));

        assertQueueEmpty(ParserTopology.PARSER_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_RESULT_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_RETRY_QUEUE);
        assertQueueEmpty(ParserTopology.PARSER_DLQ);
    }

    private static RabbitReplayProcessingDispatcher dispatcher() {
        return new RabbitReplayProcessingDispatcher(template, CODEC);
    }

    private static ParserResultMessage resultEnvelope(final String eventId, final int attempt) {
        return new ParserResultMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                eventId,
                JOB_ID,
                attempt,
                Instant.parse("2026-01-01T00:00:00Z"),
                List.of(
                        new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null),
                        new ParserSourceOutcome(1, "b.wotbreplay", ParserSourceStatus.FAILED, "REPLAY_PROCESSING_FAILED")));
    }

    private static SimpleMessageListenerContainer listenerContainer(final ParserOutcomeHandler handler) {
        final SimpleMessageListenerContainer container = new SimpleMessageListenerContainer(connectionFactory);
        container.setQueueNames(ParserTopology.PARSER_RESULT_QUEUE);
        container.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        container.setPrefetchCount(1);
        container.setMessageListener(new ParserResultListener(CODEC, handler));
        return container;
    }

    private static void publish(final String routingKey, final byte[] body) {
        final MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        template.send(ParserTopology.JOBS_EXCHANGE, routingKey, new Message(body, properties));
    }

    /** Reads and acknowledges the first available message, or {@code null} after the timeout. */
    private static Message receiveFrom(final String queue) {
        final long deadline = System.nanoTime() + SETTLE_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            final Message message = template.receive(queue);
            if (message != null) {
                return message;
            }
            sleep();
        }
        return null;
    }

    private static GetResponse pollGet(final Channel channel, final String queue) throws Exception {
        final long deadline = System.nanoTime() + SETTLE_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            final GetResponse response = channel.basicGet(queue, false);
            if (response != null) {
                return response;
            }
            sleep();
        }
        return null;
    }

    private static void assertQueueEmpty(final String queue) {
        assertNull(template.receive(queue), queue + " must have no ready message");
    }

    /**
     * Polls Management API queue statistics until the settled state is observed.
     *
     * <p>RabbitMQ only reports a counter once its statistics collector has emitted a sample for the
     * queue, so an absent counter means "not collected yet" and must be polled again rather than
     * dereferenced.</p>
     */
    private static JsonNode awaitStats(final String queue, final String description, final Predicate<JsonNode> settled) {
        JsonNode latest = null;
        final long deadline = System.nanoTime() + SETTLE_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            latest = queueStats(queue);
            if (settled.test(latest)) {
                return latest;
            }
            sleep();
        }
        throw new AssertionError(queue + " never reported " + description + "; last statistics: " + latest);
    }

    private static boolean counterIsZero(final JsonNode stats, final String counter) {
        final JsonNode value = stats.get(counter);
        return value != null && value.asInt() == 0;
    }

    private static boolean counterIsAtLeast(final JsonNode stats, final String counter, final int minimum) {
        final JsonNode value = stats.get(counter);
        return value != null && value.asInt() >= minimum;
    }

    /** True once the queue holds no ready message and no delivery is still outstanding. */
    private static boolean isFullySettled(final JsonNode stats) {
        return counterIsZero(stats, "messages_ready") && counterIsZero(stats, "messages_unacknowledged");
    }

    /** Queue counters come from the Management API; only the bootstrap administrator can read them. */
    private static JsonNode queueStats(final String queue) {
        final JsonNode stats = managementGet("/api/queues/%2F/" + queue);
        assertNotNull(stats, "Management API must expose queue statistics for " + queue);
        return stats;
    }

    private static JsonNode managementGet(final String path) {
        final String authorization =
                Base64.getEncoder().encodeToString((ADMIN_USER + ":" + ADMIN_PASSWORD).getBytes(StandardCharsets.UTF_8));
        final HttpRequest request = HttpRequest.newBuilder(URI.create(BROKER.getHttpUrl() + path))
                .header("Authorization", "Basic " + authorization)
                .timeout(Duration.ofSeconds(10))
                .GET()
                .build();
        try {
            final HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                return null;
            }
            return JsonMapper.builder().build().readTree(response.body());
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while calling the Management API", e);
        } catch (final Exception e) {
            throw new IllegalStateException("cannot call the Management API", e);
        }
    }

    private static void assertMatchesSchemaRequired(final String definition, final byte[] body) {
        final JsonNode schema = JsonMapper.builder().build().readTree(SCHEMA_PATH);
        final JsonNode produced = JsonMapper.builder().build().readTree(body);
        final JsonNode required = schema.get("definitions").get(definition).get("required");
        assertFalse(required == null || required.isEmpty(), definition + " schema must declare required fields");
        for (final JsonNode field : required.values()) {
            assertTrue(produced.has(field.asString()), definition + " envelope must carry " + field.asString());
        }
    }

    private static void awaitManagementApi() {
        final long deadline = System.nanoTime() + SETTLE_TIMEOUT.toNanos();
        while (System.nanoTime() < deadline) {
            if (managementGet("/api/overview") != null) {
                return;
            }
            sleep();
        }
        fail("the RabbitMQ Management API did not become ready");
    }

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
            channel.queueBind(
                    ParserTopology.PARSER_QUEUE,
                    ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_REQUEST_ROUTING_KEY);
            channel.queueBind(
                    ParserTopology.PARSER_RETRY_QUEUE,
                    ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_RETRY_ROUTING_KEY);
            channel.queueBind(
                    ParserTopology.PARSER_DLQ,
                    ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_DEAD_ROUTING_KEY);
            channel.queueBind(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    ParserTopology.JOBS_EXCHANGE,
                    ParserTopology.PARSER_RESULT_ROUTING_KEY);
            channel.queueBind(
                    ParserTopology.PARSER_RESULT_QUEUE,
                    ParserTopology.JOBS_EXCHANGE,
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

    private static void awaitQuietly(final CountDownLatch latch) {
        try {
            latch.await(20, TimeUnit.SECONDS);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void sleep() {
        try {
            Thread.sleep(POLL_MILLIS);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while waiting for the broker", e);
        }
    }
}
