package com.wotb.ai;

import com.wotb.ai.config.AiModelProperties;
import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
@EnableConfigurationProperties(AiModelProperties.class)
public class AiServiceApplication {
    public static void main(final String[] args) {
        SpringApplication.run(AiServiceApplication.class, args);
    }

    @Bean
    AiTokenEstimator aiTokenEstimator() {
        return new ConservativeDeepSeekTokenEstimator();
    }
}
