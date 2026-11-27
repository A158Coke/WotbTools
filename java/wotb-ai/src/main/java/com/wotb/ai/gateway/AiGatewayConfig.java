package com.wotb.ai.gateway;

import com.wotb.ai.config.AiModelProperties;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AiGatewayConfig {

    @Bean
    public AiChatGateway aiChatGateway(final AiModelProperties properties,
                                       final ObjectProvider<MeterRegistry> meterRegistry) {
        return SpringAiChatGateway.fromProperties(properties, meterRegistry.getIfAvailable());
    }
}
