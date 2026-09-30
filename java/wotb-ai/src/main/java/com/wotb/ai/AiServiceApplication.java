package com.wotb.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.web.config.AiModelProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

@SpringBootApplication(scanBasePackages = "com.wotb.web.replay.ai")
@EnableConfigurationProperties(AiModelProperties.class)
@Import({AiServiceSecurityConfig.class, AiReviewController.class})
public class AiServiceApplication {
    public static void main(final String[] args) {
        SpringApplication.run(AiServiceApplication.class, args);
    }

    @Bean
    AiTokenEstimator aiTokenEstimator() {
        return new ConservativeDeepSeekTokenEstimator();
    }
}
