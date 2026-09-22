package com.wotb.parserworker;

import static java.util.Map.entry;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.broker.rabbitmq.ParserTopology;
import com.wotb.broker.rabbitmq.RabbitBrokerProperties;
import com.wotb.storage.MinioObjectStorageProperties;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.assertj.AssertableApplicationContext;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;

/**
 * parser worker 的**生产配置契约**测试：用真实 {@code application.yml} + 进程环境变量形状的属性启动 Spring
 * 上下文，验证不可变配置对象真的拿到环境值、缺凭据时启动失败、以及装配确实消费绑定结果。
 *
 * <p>生产事故（parser-worker 在 Yecao 重启循环、{@code accessKey must not be blank}）的根因是
 * {@code ParserWorkerAssembly} 用 {@code @Bean} + {@code @ConfigurationProperties} 返回 record：
 * Spring Boot 对 {@code @Bean} 方法的返回值只做 JavaBean 绑定，record 没有 setter，注解被静默忽略，
 * 于是环境里的凭据永远不生效，代码里的占位值先撞上构造器校验。这里不构造任何 record，全部经
 * Spring 绑定路径验证——{@link ParserWorkerConfigBindingTest#theAssemblyDeclaresNoConfigurationBinding}
 * 另附结构性守卫，防止该失效注解回归。</p>
 */
class ParserWorkerConfigBindingTest {

    /**
     * 生产契约：{@code deploy/docker-compose.prod.yml} 的 parser-worker {@code environment} 变量名
     * 逐字不变，只把值换成本测试的假值。可选键也一并给出非默认值，用来证明它们确实被绑定而不是被忽略。
     */
    private static final Map<String, String> PRODUCTION_CONTRACT = Map.ofEntries(
            entry("MINIO_ENDPOINT", "test-minio:9000"),
            entry("MINIO_BUCKET", "test-bucket"),
            entry("MINIO_ACCESS_KEY", "test-access"),
            entry("MINIO_SECRET_KEY", "test-secret"),
            entry("MINIO_CONNECT_TIMEOUT_SEC", "21"),
            entry("MINIO_WRITE_TIMEOUT_SEC", "42"),
            entry("RABBITMQ_HOST", "test-rabbit"),
            entry("RABBITMQ_PORT", "5672"),
            entry("RABBITMQ_VHOST", "/wotbtools"),
            entry("RABBITMQ_USERNAME", "test-worker"),
            entry("RABBITMQ_PASSWORD", "test-password"),
            entry("PARSER_WORKER_CONCURRENCY", "4"),
            entry("PARSER_WORKER_PREFETCH", "3"),
            entry("PARSER_WORKER_CONFIRM_TIMEOUT_SEC", "7"),
            entry("PARSER_WORKER_SHUTDOWN_TIMEOUT_SEC", "11"));

    /** 只提供没有默认值的键：其余键必须继续取 {@code application.yml} 的既有默认值。 */
    private static final Map<String, String> REQUIRED_ONLY = Map.of(
            "MINIO_ACCESS_KEY", "test-access",
            "MINIO_SECRET_KEY", "test-secret",
            "RABBITMQ_HOST", "test-rabbit",
            "RABBITMQ_USERNAME", "test-worker",
            "RABBITMQ_PASSWORD", "test-password");

    @Test
    void bindsTheProductionEnvironmentContractIntoImmutableProperties() {
        bindingRunner().withPropertyValues(properties(PRODUCTION_CONTRACT)).run(context -> {
            final MinioObjectStorageProperties minio = context.getBean(MinioObjectStorageProperties.class);
            assertEquals("test-minio:9000", minio.endpoint(), "MINIO_ENDPOINT");
            assertEquals("test-bucket", minio.bucket(), "MINIO_BUCKET");
            assertEquals("test-access", minio.accessKey(), "MINIO_ACCESS_KEY");
            assertEquals("test-secret", minio.secretKey(), "MINIO_SECRET_KEY");
            assertEquals(21, minio.connectTimeoutSeconds(), "MINIO_CONNECT_TIMEOUT_SEC");
            assertEquals(42, minio.writeTimeoutSeconds(), "MINIO_WRITE_TIMEOUT_SEC");

            final RabbitBrokerProperties broker = context.getBean(RabbitBrokerProperties.class);
            assertEquals("test-rabbit", broker.host(), "RABBITMQ_HOST");
            assertEquals(5672, broker.port(), "RABBITMQ_PORT");
            assertEquals("/wotbtools", broker.vhost(), "RABBITMQ_VHOST");
            assertEquals("test-worker", broker.username(), "RABBITMQ_USERNAME");
            assertEquals("test-password", broker.password(), "RABBITMQ_PASSWORD");

            final ParserWorkerProperties worker = context.getBean(ParserWorkerProperties.class);
            assertEquals(4, worker.concurrency(), "PARSER_WORKER_CONCURRENCY");
            assertEquals(3, worker.prefetch(), "PARSER_WORKER_PREFETCH");
            assertEquals(7, worker.confirmTimeoutSeconds(), "PARSER_WORKER_CONFIRM_TIMEOUT_SEC");
            assertEquals(11, worker.shutdownTimeoutSeconds(), "PARSER_WORKER_SHUTDOWN_TIMEOUT_SEC");
        });
    }

    @Test
    void keepsTheReviewedDefaultsWhenOnlyRequiredValuesAreProvided() {
        bindingRunner().withPropertyValues(properties(REQUIRED_ONLY)).run(context -> {
            final MinioObjectStorageProperties minio = context.getBean(MinioObjectStorageProperties.class);
            assertEquals("10.20.0.2:9000", minio.endpoint(), "MINIO_ENDPOINT 默认值");
            assertEquals("wotbtools-temp", minio.bucket(), "MINIO_BUCKET 默认值");
            assertEquals(10, minio.connectTimeoutSeconds(), "MINIO_CONNECT_TIMEOUT_SEC 默认值");
            assertEquals(60, minio.writeTimeoutSeconds(), "MINIO_WRITE_TIMEOUT_SEC 默认值");

            final RabbitBrokerProperties broker = context.getBean(RabbitBrokerProperties.class);
            assertEquals(5672, broker.port(), "RABBITMQ_PORT 默认值");
            assertEquals("/", broker.vhost(), "RABBITMQ_VHOST 默认值");

            final ParserWorkerProperties worker = context.getBean(ParserWorkerProperties.class);
            assertEquals(2, worker.concurrency(), "PARSER_WORKER_CONCURRENCY 默认值");
            assertEquals(1, worker.prefetch(), "PARSER_WORKER_PREFETCH 默认值");
            assertEquals(10, worker.confirmTimeoutSeconds(), "PARSER_WORKER_CONFIRM_TIMEOUT_SEC 默认值");
            assertEquals(30, worker.shutdownTimeoutSeconds(), "PARSER_WORKER_SHUTDOWN_TIMEOUT_SEC 默认值");
        });
    }

    /** 缺凭据时必须启动失败，且错误信息点名缺失的环境变量（fail closed，绝不用占位凭据继续启动）。 */
    @ParameterizedTest(name = "缺少 {0} 时启动失败")
    @ValueSource(strings = {"MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "RABBITMQ_PASSWORD"})
    void missingCredentialFailsStartupWithTheEnvironmentVariableNamed(final String variable) {
        bindingRunner().withPropertyValues(properties(without(variable))).run(context ->
                assertStartupFails(context, variable));
    }

    /** 显式置空同样 fail closed：值真的被绑定到 record，由 record 构造器拒绝（校验未被削弱）。 */
    @ParameterizedTest(name = "{0} 为空时启动失败")
    @CsvSource({
            "MINIO_ACCESS_KEY, accessKey must not be blank",
            "MINIO_SECRET_KEY, secretKey must not be blank",
            "RABBITMQ_PASSWORD, password must not be blank"})
    void blankCredentialFailsStartupWithTheRecordValidation(final String variable, final String expected) {
        bindingRunner().withPropertyValues(properties(withBlank(variable))).run(context ->
                assertStartupFails(context, expected));
    }

    /**
     * 装配必须消费绑定结果：连接工厂与 listener 容器携带的是环境里的值，而不是代码里的占位值。
     * 容器不自动启动（测试没有 broker），其余装配全部真实创建。
     */
    @Test
    void theAssemblyConsumesTheBoundConfiguration() {
        assemblyRunner().withPropertyValues(properties(PRODUCTION_CONTRACT)).run(context -> {
            final CachingConnectionFactory connectionFactory = context.getBean(CachingConnectionFactory.class);
            assertEquals("test-rabbit", connectionFactory.getHost(), "连接工厂必须使用绑定的 RABBITMQ_HOST");
            assertEquals(5672, connectionFactory.getPort(), "连接工厂必须使用绑定的 RABBITMQ_PORT");
            assertEquals("/wotbtools", connectionFactory.getVirtualHost(), "连接工厂必须使用绑定的 RABBITMQ_VHOST");
            assertEquals("test-worker", connectionFactory.getUsername(), "连接工厂必须使用绑定的 RABBITMQ_USERNAME");
            assertTrue(connectionFactory.isPublisherReturns(),
                    "发布确认语义是装配契约的一部分，不因配置绑定而改变");

            final SimpleMessageListenerContainer container =
                    context.getBean(SimpleMessageListenerContainer.class);
            assertEquals(Arrays.asList(ParserTopology.PARSER_QUEUE), Arrays.asList(container.getQueueNames()),
                    "worker 只消费工作队列");
            assertEquals(AcknowledgeMode.MANUAL, container.getAcknowledgeMode(),
                    "manual ack 语义不因配置绑定而改变");
            assertFalse(container.isRunning(), "绑定测试不应启动 consumer（没有 broker）");
            // 并发/prefetch/停机预算由装配从绑定的 ParserWorkerProperties 读取（无公开 getter）：
            // 绑定值本身由 bindsTheProductionEnvironmentContractIntoImmutableProperties 断言，
            // 容器侧的并发语义由 ParserWorkerPipelineTest#theContainerRunsTheConfiguredNumberOfConsumers 对真实 broker 断言。
        });
    }

    /**
     * 结构性守卫（行为契约由上面的上下文测试保证）：装配类不得再自行声明/绑定不可变配置对象。
     * {@code @Bean} + {@code @ConfigurationProperties} 对 record 是**静默失效**的绑定——这正是生产
     * 事故的形态（占位凭据先撞上构造器校验，真实配置永远不生效），因此该注解在本类中禁止回归。
     */
    @Test
    void theAssemblyDeclaresNoConfigurationBinding() {
        final Set<Class<?>> boundTypes = Arrays.stream(ParserWorkerConfig.class.getDeclaredMethods())
                .filter(method -> method.isAnnotationPresent(Bean.class))
                .map(Method::getReturnType)
                .collect(Collectors.toSet());
        assertEquals(Set.of(ParserWorkerProperties.class, MinioObjectStorageProperties.class,
                        RabbitBrokerProperties.class), boundTypes,
                "全部不可变配置对象只能由 ParserWorkerConfig 绑定");

        for (final Method method : ParserWorkerAssembly.class.getDeclaredMethods()) {
            assertFalse(method.isAnnotationPresent(ConfigurationProperties.class),
                    "@Bean + @ConfigurationProperties 对 record 静默不绑定，装配类禁止使用：" + method.getName());
            assertFalse(method.getReturnType().equals(ParserWorkerProperties.class)
                            || method.getReturnType().equals(MinioObjectStorageProperties.class)
                            || method.getReturnType().equals(RabbitBrokerProperties.class),
                    "装配类不得自行构造配置对象：" + method.getName());
        }
    }

    // ---- helpers -------------------------------------------------------------------------------

    /**
     * 与生产一致的绑定路径：真实 {@code application.yml}（它把进程环境变量映射成属性键）+ 严格占位符解析
     * （缺失的必需键直接抛 {@code Could not resolve placeholder}，而不是把占位符文本当值用）。
     */
    private static ApplicationContextRunner bindingRunner() {
        return new ApplicationContextRunner()
                .withInitializer(new ConfigDataApplicationContextInitializer())
                .withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
                .withUserConfiguration(ParserWorkerConfig.class);
    }

    /** 额外加载真实装配：证明装配消费的是绑定结果。 */
    private static ApplicationContextRunner assemblyRunner() {
        return bindingRunner()
                .withBean(NoAutoStartListenerContainers.class)
                .withUserConfiguration(ParserWorkerAssembly.class);
    }

    private static String[] properties(final Map<String, String> values) {
        return values.entrySet().stream()
                .map(entry -> entry.getKey() + "=" + entry.getValue())
                .toArray(String[]::new);
    }

    private static Map<String, String> without(final String variable) {
        final Map<String, String> values = new LinkedHashMap<>(PRODUCTION_CONTRACT);
        values.remove(variable);
        return values;
    }

    private static Map<String, String> withBlank(final String variable) {
        final Map<String, String> values = new LinkedHashMap<>(PRODUCTION_CONTRACT);
        values.put(variable, "");
        return values;
    }

    private static void assertStartupFails(final AssertableApplicationContext context, final String expected) {
        final Throwable failure = context.getStartupFailure();
        assertNotNull(failure, "启动必须失败（fail closed），但上下文启动了：" + expected);
        final List<String> messages = causeMessages(failure);
        assertTrue(messages.stream().anyMatch(message -> message.contains(expected)),
                () -> "启动失败原因必须包含 '" + expected + "'，实际为 " + messages);
    }

    private static List<String> causeMessages(final Throwable failure) {
        final List<String> messages = new ArrayList<>();
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current.getMessage() != null) {
                messages.add(current.getMessage());
            }
        }
        return messages;
    }

    /**
     * 绑定测试没有 broker：容器一启动就会连 {@code test-rabbit:5672}。这里只关掉测试上下文里的自动启动，
     * 不改变任何装配参数；容器的并发/prefetch/队列语义仍由上面的断言覆盖。
     */
    static final class NoAutoStartListenerContainers implements BeanPostProcessor {

        @Override
        public Object postProcessBeforeInitialization(final Object bean, final String beanName) {
            if (bean instanceof SimpleMessageListenerContainer container) {
                container.setAutoStartup(false);
            }
            return bean;
        }
    }
}
