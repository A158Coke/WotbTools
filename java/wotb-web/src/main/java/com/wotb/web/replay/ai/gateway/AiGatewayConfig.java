package com.wotb.web.replay.ai.gateway;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.web.config.AiModelProperties;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AI Chat Gateway 与 Player/Team 编排共享配置装配。
 * <p>生产 Gateway 实现为 {@link SpringAiChatGateway}（Spring AI 2.0.0
 * OpenAI-compatible adapter + {@code https://api.deepseek.com}）。
 * {@link AiReplayAnalysisConfig} 集中持有模型/预算选项与 token estimator，供
 * {@code PlayerReplayAnalysisService} / {@code TeamReplayAnalysisService} / 兼容 facade 复用。</p>
 */
@Configuration
public class AiGatewayConfig {

    @Bean
    public AiChatGateway aiChatGateway(final AiModelProperties properties,
                                       final ObjectProvider<MeterRegistry> meterRegistry) {
        return SpringAiChatGateway.fromProperties(properties, meterRegistry.getIfAvailable());
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
