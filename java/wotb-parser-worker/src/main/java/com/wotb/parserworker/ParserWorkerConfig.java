package com.wotb.parserworker;

import com.wotb.broker.rabbitmq.RabbitBrokerProperties;
import com.wotb.storage.MinioObjectStorageProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * parser worker 的**外部配置绑定**：把 {@code application.yml}（它再把进程环境变量映射成属性键）解析成
 * 不可变的配置对象。装配（连接工厂、listener 容器、sink）在 {@link ParserWorkerAssembly}，本类只负责
 * "环境 → 不可变 record" 这一件事，因此可以脱离 broker / 对象存储单独验证。
 *
 * <p><b>为什么不是 {@code @Bean} + {@code @ConfigurationProperties}</b>：Spring Boot 对 {@code @Bean} 方法
 * 返回的对象只做 JavaBean 绑定，而 record 没有 setter，注解因此被<b>静默忽略</b>——属性对象永远保留代码里的
 * 占位值，环境里的真实配置完全不生效（Spring Boot 4.1.1 实测：绑定后仍是占位值）。构造器绑定只对
 * <b>类型上</b>标注 {@code @ConfigurationProperties} 并用 {@code @EnableConfigurationProperties} /
 * {@code @ConfigurationPropertiesScan} 注册的类生效，而 {@link MinioObjectStorageProperties} 与
 * {@link RabbitBrokerProperties} 是共享适配器模块里的类型，被两个消费方用两套命名空间消费
 * （worker 的 {@code wotb.parser-worker.*} / {@code spring.rabbitmq.*}，控制面的 {@code wotb.replay.*}），
 * 类型本身无法固定一个前缀，共享模块也不应为此引入 Spring Boot 依赖。这里沿用控制面
 * （{@code ReplayDistributedConfig}）的既有约定：由消费方把已解析的环境值注入不可变构造器——
 * 生命周期是「解析 → 构造 → record 校验」，不存在"先造占位对象、再尝试绑定/改写"的中间态。
 *
 * <p><b>fail-closed</b>：凭据在 {@code application.yml} 里没有默认值，缺失时占位符解析直接失败
 * （错误信息点名环境变量，如 {@code Could not resolve placeholder 'MINIO_ACCESS_KEY'}）；显式置空则被
 * record 构造器的 {@code must not be blank} 拒绝。两条路径都让启动失败，绝不会退化成占位凭据。
 */
@Configuration
public class ParserWorkerConfig {

    /**
     * {@link RabbitBrokerProperties#prefetch()} 属于控制面消费语义，worker 的每 consumer 未确认上限是
     * {@link ParserWorkerProperties#prefetch()}（由 listener 容器拥有），本字段在 worker 里不参与任何装配；
     * 保持既有取值，避免改变该 record 的既有语义。
     */
    private static final int CONTROL_PLANE_OWNED_PREFETCH = 2;

    @Bean
    ParserWorkerProperties parserWorkerProperties(
            @Value("${wotb.parser-worker.concurrency}") final int concurrency,
            @Value("${wotb.parser-worker.prefetch}") final int prefetch,
            @Value("${wotb.parser-worker.confirm-timeout-seconds}") final int confirmTimeoutSeconds,
            @Value("${wotb.parser-worker.shutdown-timeout-seconds}") final int shutdownTimeoutSeconds) {
        return new ParserWorkerProperties(concurrency, prefetch, confirmTimeoutSeconds, shutdownTimeoutSeconds);
    }

    @Bean
    MinioObjectStorageProperties minioObjectStorageProperties(
            @Value("${wotb.parser-worker.minio.endpoint}") final String endpoint,
            @Value("${wotb.parser-worker.minio.bucket}") final String bucket,
            @Value("${wotb.parser-worker.minio.access-key}") final String accessKey,
            @Value("${wotb.parser-worker.minio.secret-key}") final String secretKey,
            @Value("${wotb.parser-worker.minio.connect-timeout-seconds}") final int connectTimeoutSeconds,
            @Value("${wotb.parser-worker.minio.write-timeout-seconds}") final int writeTimeoutSeconds) {
        return new MinioObjectStorageProperties(endpoint, bucket, accessKey, secretKey,
                connectTimeoutSeconds, writeTimeoutSeconds);
    }

    @Bean
    RabbitBrokerProperties rabbitBrokerProperties(
            @Value("${spring.rabbitmq.host}") final String host,
            @Value("${spring.rabbitmq.port}") final int port,
            @Value("${spring.rabbitmq.virtual-host}") final String virtualHost,
            @Value("${spring.rabbitmq.username}") final String username,
            @Value("${spring.rabbitmq.password}") final String password) {
        return new RabbitBrokerProperties(host, port, virtualHost, username, password,
                CONTROL_PLANE_OWNED_PREFETCH);
    }
}
