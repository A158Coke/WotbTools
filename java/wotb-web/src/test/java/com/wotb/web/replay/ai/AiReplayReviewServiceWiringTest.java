package com.wotb.web.replay.ai;

import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.lang.reflect.Field;
import java.nio.file.Files;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;

/**
 * 生产 Spring 装配证明（plan §12）：{@code ReplayProcessingJobStore}（{@code @Component}，
 * 属 {@code com.wotb.web} 组件扫描包）必须作为非空依赖注入 {@link AiReplayReviewService} 的
 * AI Dataset 路径。若 production 装配后 {@code processingStore == null}，Analyze 会静默
 * 返回 {@code DATASET_UNAVAILABLE}——此测试在 Docker-free 的最小上下文中证明 Spring
 * 构造器注入能拿到 store，杜绝「启动成功、运行时才失败」的装配漂移。
 *
 * <p>不依赖 Testcontainers / DB（仅注册 store + AI 依赖替身），在无 Docker 的 CI 中也能跑。</p>
 */
class AiReplayReviewServiceWiringTest {

    @Configuration
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

        @Bean
        AiReplayReviewService reviewService(final ReplayProcessingJobStore store,
                                            final AiReplayAnalysisService aiAnalysisService,
                                            final TacticalReviewHarness tacticalReviewHarness) {
            return new AiReplayReviewService(aiAnalysisService, tacticalReviewHarness, null, store);
        }
    }

    @Test
    void productionWiringInjectsNonNullProcessingStore() {
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
                            "生产 Spring 必须注入非空 ReplayProcessingJobStore（AI Dataset 路径依赖）");
                    assertSame(store, injected,
                            "注入的 store 必须与容器中的 ReplayProcessingJobStore bean 是同一实例");
                });
    }
}
