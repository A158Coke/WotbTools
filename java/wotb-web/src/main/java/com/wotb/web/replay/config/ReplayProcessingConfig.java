package com.wotb.web.replay.config;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 将 wotb-core 的回放处理服务暴露为 Spring Bean，供控制器构造器注入
 * （替代控制器内手动 {@code new}，便于测试替身/监控/后续扩展）。
 */
@Configuration
public class ReplayProcessingConfig {

    @Bean
    public ReplayReconstructionService replayReconstructionService() {
        return new ReplayReconstructionService();
    }

    @Bean
    public DefaultReplayProcessingFacade replayProcessingFacade(
            ReplayReconstructionService reconstructionService) {
        return new DefaultReplayProcessingFacade(reconstructionService);
    }
}
