package com.wotb.broker.rabbitmq;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.rabbitmq.client.Channel;
import com.rabbitmq.client.ConnectionFactory;
import com.wotb.contracts.ReplayProcessingRequest;
import com.wotb.contracts.ReplayProcessingSource;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Delivery-observation contract of {@link RabbitReplayProcessingDispatcher} against a real broker.
 *
 * <p>{@code ReplayProcessingJobService} treats a successful {@code submit} as the commit point for
 * the authoritative operationId identity, so the adapter may only return after the broker confirmed
 * the publish <em>and</em> the message was routable. These tests pin that invariant from the outside:
 * a confirmed publish really reaches {@code wotb.parser}, an unroutable publish fails, an
 * unreachable broker fails, and a template without confirmed delivery is rejected at construction
 * instead of silently degrading to fire-and-forget.</p>
 */
@Testcontainers(disabledWithoutDocker = true)
class RabbitReplayProcessingDispatcherTest {

    @Container
    static final RabbitMQContainer BROKER = new RabbitMQContainer("rabbitmq:4.3.6-management-alpine");

    private static final Duration CONFIRM_TIMEOUT = Duration.ofSeconds(5);

    @Test
    void confirmedPublishReachesTheWorkQueue() throws Exception {
        declareTopology(true);
        final CachingConnectionFactory factory = confirmedConnectionFactory(BROKER.getHost(), BROKER.getAmqpPort());
        try {
            final RabbitTemplate template = new RabbitTemplate(factory);
            final RabbitReplayProcessingDispatcher dispatcher =
                    new RabbitReplayProcessingDispatcher(template, new ParserMessageCodec(), CONFIRM_TIMEOUT);

            dispatcher.submit(request("job-confirmed"));

            final Message received = new RabbitTemplate(factory).receive(ParserTopology.PARSER_QUEUE, 5_000);
            assertNotNull(received, "broker-confirmed parser.request must be routable to the work queue");
            assertTrue(new String(received.getBody(), StandardCharsets.UTF_8).contains("job-confirmed"));
        } finally {
            factory.destroy();
        }
    }

    /**
     * 逻辑重试的 attempt 属于控制面的命令，适配器必须原样上线：它既不能把 {@code attempt+1}
     * 改回 1（worker 会用它回报结果），也不能自己发明 attempt。
     */
    @Test
    void retryAttemptIsPublishedUnchanged() throws Exception {
        declareTopology(true);
        final CachingConnectionFactory factory = confirmedConnectionFactory(BROKER.getHost(), BROKER.getAmqpPort());
        try {
            final RabbitReplayProcessingDispatcher dispatcher = new RabbitReplayProcessingDispatcher(
                    new RabbitTemplate(factory), new ParserMessageCodec(), CONFIRM_TIMEOUT);

            dispatcher.submit(new ReplayProcessingRequest("job-retry",
                    List.of(new ReplayProcessingSource(0, "a.wotbreplay")), 3));

            final Message received = new RabbitTemplate(factory).receive(ParserTopology.PARSER_QUEUE, 5_000);
            assertNotNull(received);
            final ParserRequestMessage decoded = new ParserMessageCodec().decodeRequest(received.getBody());
            assertEquals("job-retry", decoded.jobId());
            assertEquals(3, decoded.attempt());
        } finally {
            factory.destroy();
        }
    }

    @Test
    void unroutablePublishFailsClosed() throws Exception {
        // exchange + work queue 存在但没有 binding：broker 会 ack 这条 mandatory 消息并回 return，
        // 因此只有检查 returned message 才能发现「没有任何消费者会收到它」。
        declareTopology(false);
        final CachingConnectionFactory factory = confirmedConnectionFactory(BROKER.getHost(), BROKER.getAmqpPort());
        try {
            final RabbitReplayProcessingDispatcher dispatcher = new RabbitReplayProcessingDispatcher(
                    new RabbitTemplate(factory), new ParserMessageCodec(), CONFIRM_TIMEOUT);

            assertThrows(ParserDispatchException.class, () -> dispatcher.submit(request("job-unroutable")));
        } finally {
            factory.destroy();
        }
    }

    @Test
    void unavailableBrokerFailsClosed() {
        // 未监听的端口：连接直接失败，绝不能返回成功。
        final CachingConnectionFactory factory = confirmedConnectionFactory("127.0.0.1", 1);
        try {
            final RabbitReplayProcessingDispatcher dispatcher = new RabbitReplayProcessingDispatcher(
                    new RabbitTemplate(factory), new ParserMessageCodec(), CONFIRM_TIMEOUT);

            assertThrows(ParserDispatchException.class, () -> dispatcher.submit(request("job-no-broker")));
        } finally {
            factory.destroy();
        }
    }

    @Test
    void constructionRejectsTemplateWithoutConfirmedDelivery() {
        final CachingConnectionFactory withoutConfirms =
                confirmedConnectionFactory(BROKER.getHost(), BROKER.getAmqpPort());
        withoutConfirms.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.NONE);
        try {
            assertThrows(IllegalStateException.class, () -> new RabbitReplayProcessingDispatcher(
                    new RabbitTemplate(withoutConfirms), new ParserMessageCodec(), CONFIRM_TIMEOUT));
        } finally {
            withoutConfirms.destroy();
        }

        final CachingConnectionFactory withoutReturns =
                confirmedConnectionFactory(BROKER.getHost(), BROKER.getAmqpPort());
        withoutReturns.setPublisherReturns(false);
        try {
            assertThrows(IllegalStateException.class, () -> new RabbitReplayProcessingDispatcher(
                    new RabbitTemplate(withoutReturns), new ParserMessageCodec(), CONFIRM_TIMEOUT));
        } finally {
            withoutReturns.destroy();
        }
    }

    private static CachingConnectionFactory confirmedConnectionFactory(final String host, final int port) {
        final CachingConnectionFactory factory = new CachingConnectionFactory(host, port);
        factory.setUsername(BROKER.getAdminUsername());
        factory.setPassword(BROKER.getAdminPassword());
        factory.setVirtualHost("/");
        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        factory.setPublisherReturns(true);
        return factory;
    }

    /** Test fixture only: production code must never declare the OpenTofu-owned topology. */
    private static void declareTopology(final boolean withBinding) throws Exception {
        final ConnectionFactory factory = new ConnectionFactory();
        factory.setHost(BROKER.getHost());
        factory.setPort(BROKER.getAmqpPort());
        factory.setUsername(BROKER.getAdminUsername());
        factory.setPassword(BROKER.getAdminPassword());
        factory.setVirtualHost("/");
        try (com.rabbitmq.client.Connection connection = factory.newConnection();
             Channel channel = connection.createChannel()) {
            channel.exchangeDeclare(ParserTopology.JOBS_EXCHANGE, "topic", true);
            channel.queueDeclare(ParserTopology.PARSER_QUEUE, true, false, false, null);
            if (withBinding) {
                channel.queueBind(ParserTopology.PARSER_QUEUE, ParserTopology.JOBS_EXCHANGE,
                        ParserTopology.PARSER_REQUEST_ROUTING_KEY);
            }
        }
    }

    private static ReplayProcessingRequest request(final String jobId) {
        return new ReplayProcessingRequest(jobId,
                List.of(new ReplayProcessingSource(0, "a.wotbreplay")), ReplayProcessingRequest.FIRST_ATTEMPT);
    }
}
