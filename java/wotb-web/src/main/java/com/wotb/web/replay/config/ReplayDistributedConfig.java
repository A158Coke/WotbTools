package com.wotb.web.replay.config;

import com.wotb.broker.rabbitmq.ParserMessageCodec;
import com.wotb.broker.rabbitmq.ParserOutcomeHandler;
import com.wotb.broker.rabbitmq.ParserResultListener;
import com.wotb.broker.rabbitmq.ParserTopology;
import com.wotb.broker.rabbitmq.RabbitBrokerProperties;
import com.wotb.broker.rabbitmq.RabbitReplayProcessingDispatcher;
import com.wotb.contracts.ObjectStorage;
import com.wotb.web.replay.job.MinioReplayProcessingInputStore;
import com.wotb.web.replay.job.ObjectStorageReplayProcessingResultReader;
import com.wotb.web.replay.job.PostgresParserOutcomeHandler;
import com.wotb.web.replay.job.ReplayExecutionMode;
import com.wotb.web.replay.job.ReplayJobAuthority;
import com.wotb.web.replay.job.ReplayProcessingInputStore;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import com.wotb.web.replay.job.ReplayProcessingResultReader;
import com.wotb.storage.MinioObjectStorage;
import com.wotb.storage.MinioObjectStorageProperties;
import com.rabbitmq.client.ConnectionFactory;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * 分布式回放控制面装配（{@code wotb.replay.execution.mode=distributed}）。
 *
 * <p><b>位置</b>：放在 replay 域内而不是共享 {@code com.wotb.web.config}——共享 config 与各域之间由
 * {@code WebArchitectureTest} 保证无环（{@code com.wotb.web.(*)..} free of cycles），而 replay 域
 * 已经依赖共享 config（{@code ApiPaths}），共享 config 反向依赖 replay 会成环。</p>
 *
 * <p><b>缺省不创建任何 bean</b>：整类由 {@code @ConditionalOnProperty} 门控，属性缺失（local）时
 * 连一个 bean definition 都不会注册；local 执行组件（{@code ReplayParseScheduler} /
 * {@code LocalReplayProcessingDispatcher} / {@code LocalReplayProcessingExecutor}）在分布式模式下
 * 反向关闭，因此两种模式的执行平面永远只有一套。</p>
 *
 * <p><b>不声明拓扑</b>：exchange/queue/binding 的唯一所有者仍是 {@code infra/tofu/rabbitmq}，
 * 本类只把已有 adapter 接到连接上。</p>
 */
@Configuration
@ConditionalOnProperty(name = ReplayExecutionMode.PROPERTY,
        havingValue = ReplayExecutionMode.DISTRIBUTED_VALUE)
public class ReplayDistributedConfig {

    /** 结果消费是权威投影的全量替换，必须单线程：并发 apply 会互相覆盖 source 投影。 */
    private static final int SINGLE_CONSUMER = 1;

    @Bean
    public MinioObjectStorageProperties replayObjectStorageProperties(
            @Value("${wotb.replay.object-storage.endpoint:10.20.0.2:9000}") final String endpoint,
            @Value("${wotb.replay.object-storage.bucket:wotbtools-temp}") final String bucket,
            @Value("${wotb.replay.object-storage.access-key:}") final String accessKey,
            @Value("${wotb.replay.object-storage.secret-key:}") final String secretKey,
            @Value("${wotb.replay.object-storage.connect-timeout-seconds:10}") final int connectTimeoutSeconds,
            @Value("${wotb.replay.object-storage.write-timeout-seconds:60}") final int writeTimeoutSeconds) {
        // 凭据缺失即构造失败 ⇒ 分布式模式启动失败（fail closed），不会退化成本地解析。
        return new MinioObjectStorageProperties(endpoint, bucket, accessKey, secretKey,
                connectTimeoutSeconds, writeTimeoutSeconds);
    }

    @Bean
    public ObjectStorage replayObjectStorage(final MinioObjectStorageProperties properties) {
        return new MinioObjectStorage(properties);
    }

    @Bean
    public RabbitBrokerProperties replayBrokerProperties(
            @Value("${wotb.replay.broker.host:}") final String host,
            @Value("${wotb.replay.broker.port:5672}") final int port,
            @Value("${wotb.replay.broker.vhost:/}") final String vhost,
            @Value("${wotb.replay.broker.username:}") final String username,
            @Value("${wotb.replay.broker.password:}") final String password,
            @Value("${wotb.replay.broker.prefetch:1}") final int prefetch) {
        return new RabbitBrokerProperties(host, port, vhost, username, password, prefetch);
    }

    /**
     * 控制面连接工厂：**必须**开启 correlated publisher confirms 与 publisher returns，
     * 否则 {@link RabbitReplayProcessingDispatcher} 的 fail-closed 构造守卫会拒绝装配
     * （确认式投递是 create 的 commit point 前提）。
     */
    @Bean
    public CachingConnectionFactory replayBrokerConnectionFactory(final RabbitBrokerProperties properties) {
        final ConnectionFactory factory = new ConnectionFactory();
        factory.setHost(properties.host());
        factory.setPort(properties.port());
        factory.setVirtualHost(properties.vhost());
        factory.setUsername(properties.username());
        factory.setPassword(properties.password());
        final CachingConnectionFactory caching = new CachingConnectionFactory(factory);
        caching.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        caching.setPublisherReturns(true);
        return caching;
    }

    @Bean
    public RabbitTemplate replayBrokerRabbitTemplate(
            final CachingConnectionFactory replayBrokerConnectionFactory) {
        return new RabbitTemplate(replayBrokerConnectionFactory);
    }

    @Bean
    public ParserMessageCodec replayParserMessageCodec() {
        return new ParserMessageCodec();
    }

    /** 唯一的 {@code ReplayProcessingDispatcher}：确认式 AMQP 投递，`submit` 失败即 create 失败。 */
    @Bean
    public RabbitReplayProcessingDispatcher replayProcessingDispatcher(
            final RabbitTemplate replayBrokerRabbitTemplate,
            final ParserMessageCodec replayParserMessageCodec,
            @Value("${wotb.replay.broker.confirm-timeout-seconds:10}") final int confirmTimeoutSeconds) {
        return new RabbitReplayProcessingDispatcher(replayBrokerRabbitTemplate, replayParserMessageCodec,
                Duration.ofSeconds(confirmTimeoutSeconds));
    }

    /** create 的输入落点：对象存储（键布局由 {@code ObjectStorageKeys} 唯一拥有）。 */
    @Bean
    public ReplayProcessingInputStore replayProcessingInputStore(final ObjectStorage replayObjectStorage) {
        return new MinioReplayProcessingInputStore(replayObjectStorage);
    }

    /** {@code GET .../result} 的 dataset 来源：对象存储里的 canonical per-source dataset。 */
    @Bean
    public ReplayProcessingResultReader replayProcessingResultReader(
            final ObjectStorage replayObjectStorage) {
        return new ObjectStorageReplayProcessingResultReader(replayObjectStorage);
    }

    /**
     * 结果处理器：分布式模式**必须**有 PostgreSQL 权威状态（job/source/attempt 都在那里），
     * 否则结果无法判定陈旧/重复。缺 {@code wotb.replay.processing-job.repository=jdbc} 时
     * 启动即失败，而不是退化成一个只存在于内存里的第二套权威。
     *
     * <p>它同时是**逻辑重试的唯一决策点**：worker 的基础设施失败报告
     * （{@code parser.failed(retryable=true)}）由它按 PG 权威状态与
     * {@code wotb.replay.retry.max-attempts} 预算决定重派 {@code attempt+1} 还是转终态。</p>
     */
    @Bean
    public ParserOutcomeHandler replayParserOutcomeHandler(
            final ReplayProcessingJobStore replayProcessingJobStore,
            final ObjectProvider<ReplayJobAuthority> replayJobAuthority,
            final RabbitReplayProcessingDispatcher replayProcessingDispatcher,
            @Value("${wotb.replay.retry.max-attempts:3}") final int maxAttempts) {
        final ReplayJobAuthority authority = replayJobAuthority.getIfAvailable();
        if (authority == null) {
            throw new IllegalStateException("wotb.replay.execution.mode=distributed requires "
                    + "wotb.replay.processing-job.repository=jdbc (PostgreSQL job authority)");
        }
        return new PostgresParserOutcomeHandler(replayProcessingJobStore, authority,
                replayProcessingDispatcher, maxAttempts);
    }

    /**
     * {@code wotb.parser.result} 消费容器（{@code parser.result} 与 {@code parser.failed} 两个
     * routing key 都绑定到该队列）：manual ack（幂等 no-op 也 ack，无法应用的消息 nack 不重入队
     * → DLQ），单消费者保证同一 job 的 outcome 串行应用。
     */
    @Bean
    public SimpleMessageListenerContainer replayParserResultListenerContainer(
            final CachingConnectionFactory replayBrokerConnectionFactory,
            final ParserMessageCodec replayParserMessageCodec,
            final ParserOutcomeHandler replayParserOutcomeHandler,
            final RabbitBrokerProperties replayBrokerProperties) {
        final SimpleMessageListenerContainer container =
                new SimpleMessageListenerContainer(replayBrokerConnectionFactory);
        container.setQueueNames(ParserTopology.PARSER_RESULT_QUEUE);
        container.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        container.setConcurrentConsumers(SINGLE_CONSUMER);
        container.setMaxConcurrentConsumers(SINGLE_CONSUMER);
        container.setPrefetchCount(replayBrokerProperties.prefetch());
        container.setMessageListener(new ParserResultListener(replayParserMessageCodec, replayParserOutcomeHandler));
        return container;
    }
}
