package com.wotb.web.replay.job;

import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.web.replay.config.ReplayDistributedConfig;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.annotation.AnnotatedElementUtils;

import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 执行平面门控契约：{@code distributed} 模式下**不存在任何本地解析路径**。
 *
 * <p>这是需求里最不可退让的一条（「绝不在 TX 上本地解析」）：只要 {@code ReplayParseScheduler}
 * 或本地 dispatcher 还在，本进程就会自己建 worker 线程池解析回放。因此这里断言：
 * ① 分布式模式下这些 bean 一个都不装配；② 不出现本地 parse worker 线程；
 * ③ 缺省 / local 模式仍然装配（既有部署行为不变）。</p>
 */
class ReplayExecutionModeGatingTest {

    private static final String PARSE_WORKER_THREAD_PREFIX = "wotb-replay-parse-worker-";

    @Test
    void distributedModeAssemblesNoLocalParsePath() {
        final Set<String> threadsBefore = parseWorkerThreads();

        localComponentsRunner()
                .withPropertyValues(ReplayExecutionMode.PROPERTY + "=" + ReplayExecutionMode.DISTRIBUTED_VALUE)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).doesNotHaveBean(ReplayParseScheduler.class);
                    assertThat(context).doesNotHaveBean(LocalReplayProcessingDispatcher.class);
                });

        assertThat(parseWorkerThreads())
                .as("distributed 模式不得创建本地 parse worker 线程池")
                .isEqualTo(threadsBefore);
    }

    @Test
    void localAndMissingModeStillAssembleTheLocalScheduler() {
        localComponentsRunner()
                .withPropertyValues(ReplayExecutionMode.PROPERTY + "=" + ReplayExecutionMode.LOCAL_VALUE)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(ReplayParseScheduler.class);
                    assertThat(context).hasSingleBean(LocalReplayProcessingDispatcher.class);
                });
        localComponentsRunner().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(ReplayParseScheduler.class);
        });
    }

    @Test
    void everyGatedComponentUsesTheSamePropertyAndValue() {
        assertGatedOnLocalMode(ReplayParseScheduler.class);
        assertGatedOnLocalMode(LocalReplayProcessingDispatcher.class);
        assertGatedOnLocalMode(LocalReplayProcessingExecutor.class);

        final ConditionalOnProperty distributed = AnnotatedElementUtils
                .findMergedAnnotation(ReplayDistributedConfig.class, ConditionalOnProperty.class);
        assertThat(distributed).isNotNull();
        assertThat(distributed.name()).containsExactly(ReplayExecutionMode.PROPERTY);
        assertThat(distributed.havingValue()).isEqualTo(ReplayExecutionMode.DISTRIBUTED_VALUE);
    }

    private static void assertGatedOnLocalMode(final Class<?> component) {
        final ConditionalOnProperty gate =
                AnnotatedElementUtils.findMergedAnnotation(component, ConditionalOnProperty.class);
        assertThat(gate).as("%s 必须按执行模式门控", component.getSimpleName()).isNotNull();
        assertThat(gate.name()).containsExactly(ReplayExecutionMode.PROPERTY);
        assertThat(gate.havingValue()).isEqualTo(ReplayExecutionMode.LOCAL_VALUE);
        assertThat(gate.matchIfMissing())
                .as("%s 必须在属性缺失（缺省 local）时仍然生效", component.getSimpleName())
                .isTrue();
    }

    /** 三个本地执行组件所需的依赖（只有门控生效时才会被实例化）。 */
    private static ApplicationContextRunner localComponentsRunner() {
        return new ApplicationContextRunner()
                .withUserConfiguration(ReplayParseScheduler.class, LocalReplayProcessingDispatcher.class)
                .withBean(ReplayProcessingLifecycle.class, () -> mock(ReplayProcessingLifecycle.class))
                .withBean(LocalReplayProcessingExecutor.class, () -> mock(LocalReplayProcessingExecutor.class))
                .withBean(ReplayProcessingCancellationRegistry.class, ReplayProcessingCancellationRegistry::new);
    }

    private static Set<String> parseWorkerThreads() {
        return Thread.getAllStackTraces().keySet().stream()
                .map(Thread::getName)
                .filter(name -> name.startsWith(PARSE_WORKER_THREAD_PREFIX))
                .collect(Collectors.toSet());
    }
}
