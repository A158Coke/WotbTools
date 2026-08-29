package com.wotb.web.replay.ai;

import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

import java.lang.reflect.Field;
import java.nio.file.Files;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;

/**
 * 生产 Spring 装配证明：
 * <ul>
 *   <li>{@link ReplayProcessingJobStore}（{@code @Component}，属 {@code com.wotb.web} 组件扫描包）
 *       是 AI Dataset 路径的 <b>mandatory</b> 依赖——Spring 必须通过 {@link AiReplayReviewService}
 *       的 {@code @Autowired} 构造器注入非空 store；</li>
 *   <li>production 装配缺失该 bean 时 Spring 必须 fail-fast（启动失败），而不是启动成功后运行时
 *       才返回 {@code DATASET_UNAVAILABLE}（#164 审查）。</li>
 * </ul>
 *
 * <p>本测试<b>不</b>手工 {@code new AiReplayReviewService(...)}：通过 {@code @Import}
 * 让 Spring 使用真实 {@code @Service} bean 的 {@code @Autowired} 构造器创建实例；仅 mock
 * AI 业务依赖（AiReplayAnalysisService / TacticalReviewHarness，MeterRegistry 可选为 null），
 * ReplayProcessingJobStore 走真实 bean。不依赖 Testcontainers / DB。</p>
 */
class AiReplayReviewServiceWiringTest {

    @Configuration
    @Import(AiReplayReviewService.class)
    static class WiringConfig {
        @Bean
        ReplayProcessingJobStore processingStore() throws Exception {
            return new ReplayProcessingJobStore(Files.createTempDirectory("wotb-wiring-test"), 60);
        }

        @Bean
        AiReplayAnalysisService aiAnalysisService() {
            return mock(AiReplayAnalysisService.class);
        }

        @Bean
        TacticalReviewHarness tacticalReviewHarness() {
            return mock(TacticalReviewHarness.class);
        }
    }

    /** store 缺失时的 fail-fast 配置：无 ReplayProcessingJobStore bean。 */
    @Configuration
    @Import(AiReplayReviewService.class)
    static class MissingStoreConfig {
        @Bean
        AiReplayAnalysisService aiAnalysisService() {
            return mock(AiReplayAnalysisService.class);
        }

        @Bean
        TacticalReviewHarness tacticalReviewHarness() {
            return mock(TacticalReviewHarness.class);
        }
    }

    @Test
    void productionWiringCreatesServiceViaAutowiredConstructorWithNonNullProcessingStore() {
        new ApplicationContextRunner()
                .withUserConfiguration(WiringConfig.class)
                .run(context -> {
                    final ReplayProcessingJobStore store = context.getBean(ReplayProcessingJobStore.class);
                    final AiReplayReviewService service = context.getBean(AiReplayReviewService.class);
                    assertNotNull(store);
                    assertNotNull(service);

                    final Field field = AiReplayReviewService.class.getDeclaredField("processingStore");
                    field.setAccessible(true);
                    final Object injected = field.get(service);
                    assertNotNull(injected,
                            "Spring 必须通过 @Autowired 构造器注入非空 ReplayProcessingJobStore（AI Dataset 路径 mandatory 依赖）");
                    assertSame(store, injected,
                            "注入的 store 必须与容器中的 ReplayProcessingJobStore bean 是同一实例");
                });
    }

    @Test
    void contextFailsFastWhenProcessingStoreBeanMissing() {
        // mandatory @Autowired 依赖缺失 → Spring 启动失败（fail-fast），而非启动成功后运行时 DATASET_UNAVAILABLE。
        new ApplicationContextRunner()
                .withUserConfiguration(MissingStoreConfig.class)
                .run(context ->
                        assertNotNull(context.getStartupFailure(),
                                "ReplayProcessingJobStore 为 mandatory 依赖：production 装配缺失时 Spring 必须启动失败"));
    }
}
