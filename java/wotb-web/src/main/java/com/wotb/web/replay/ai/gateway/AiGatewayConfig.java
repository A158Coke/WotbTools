package com.wotb.web.replay.ai.gateway;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.AiReplayAnalysisConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AI Chat Gateway 与 Player/Team 编排共享配置装配。
 * <p>当前 Gateway 绑定临时 DeepSeek REST 实现；Spring AI 任务将在此替换 Gateway Bean。
 * {@link AiReplayAnalysisConfig} 集中持有模型/预算选项与 token estimator，供
 * {@code PlayerReplayAnalysisService} / {@code TeamReplayAnalysisService} / 兼容 facade 复用。</p>
 */
@Configuration
public class AiGatewayConfig {

    @Bean
    public AiChatGateway aiChatGateway(final AiModelProperties properties) {
        return new DeepSeekRestAiChatGateway(
                properties.apiKey(),
                properties.baseUrl(),
                properties.model(),
                properties.timeoutSec());
    }

    @Bean
    public AiReplayAnalysisConfig aiReplayAnalysisConfig(final AiModelProperties properties,
                                                         final AiTokenEstimator tokenEstimator) {
        return new AiReplayAnalysisConfig(
                tokenEstimator,
                properties.model(),
                properties.singleReplayMaxInputTokens(),
                properties.contextWindowTokens(),
                properties.maxOutputTokens(),
                properties.promptSafetyMarginTokens(),
                properties.thinkingEnabled(),
                properties.reasoningEffort());
    }
}