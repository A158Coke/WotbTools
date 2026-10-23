package com.wotb.ai.gateway;

import com.wotb.ai.config.AiModelProperties;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AI Chat Gateway 配置装配。
 * <p>生产 Gateway 实现为 {@link SpringAiChatGateway}（Spring AI 2.0.0
 * OpenAI-compatible adapter + {@code https://api.deepseek.com}）。
 * Review 专属的模型与预算配置由 {@code AiReviewConfig} 装配。</p>
 */
@Configuration
public class AiGatewayConfig {

    @Bean
    public AiChatGateway aiChatGateway(final AiModelProperties properties,
                                       final ObjectProvider<MeterRegistry> meterRegistry) {
        return SpringAiChatGateway.fromProperties(properties, meterRegistry.getIfAvailable());
    }
}
