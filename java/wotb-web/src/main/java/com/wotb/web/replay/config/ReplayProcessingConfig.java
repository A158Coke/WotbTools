package com.wotb.web.replay.config;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.web.replay.job.ReplayExecutionMode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 将 wotb-core 的回放处理服务暴露为 Spring Bean，供控制器构造器注入
 * （替代控制器内手动 {@code new}，便于测试替身/监控/后续扩展）。
 *
 * <p><b>回放执行模式 fail-fast</b>：本类总是存在（不属于双模式的任何一侧），因此在构造器里校验
 * {@code wotb.replay.execution.mode}。刻意不新增一个条件化配置类来做校验：
 * {@code @ConditionalOnProperty} 只能表达「匹配 / 不匹配」，未知值会让两种模式都不匹配，结果就是
 * 静默降级为 local——正是这次切换最危险的单点。非法值在启动时直接抛出。</p>
 */
@Configuration
public class ReplayProcessingConfig {

    public ReplayProcessingConfig(
            @Value("${" + ReplayExecutionMode.PROPERTY + ":" + ReplayExecutionMode.LOCAL_VALUE + "}")
            final String executionMode) {
        ReplayExecutionMode.parse(executionMode);
    }

    @Bean
    public ReplayReconstructionService replayReconstructionService() {
        return new ReplayReconstructionService();
    }

    @Bean
    public DefaultReplayProcessingFacade replayProcessingFacade(final ReplayReconstructionService reconstructionService) {
        return new DefaultReplayProcessingFacade(reconstructionService);
    }

    @Bean
    public AiTokenEstimator aiTokenEstimator() {
        return new ConservativeDeepSeekTokenEstimator();
    }
}
