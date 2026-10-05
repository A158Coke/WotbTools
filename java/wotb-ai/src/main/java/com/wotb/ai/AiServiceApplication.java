package com.wotb.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.web.config.AiModelProperties;
import com.wotb.ai.tournament.TournamentGroupRecognitionController;
import com.wotb.ai.tournament.TournamentGroupRecognizer;
import com.wotb.ai.tournament.TournamentRecognitionExceptionHandler;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

@SpringBootApplication(scanBasePackages = "com.wotb.web.replay.ai")
@EnableConfigurationProperties(AiModelProperties.class)
// com.wotb.ai 不在 scanBasePackages 内，因此本包的 bean 必须显式登记（否则 @RestControllerAdvice 静默失效）。
@Import({AiServiceSecurityConfig.class, AiReviewController.class, AiReviewExceptionHandler.class,
        TournamentGroupRecognitionController.class, TournamentGroupRecognizer.class,
        TournamentRecognitionExceptionHandler.class})
public class AiServiceApplication {
    public static void main(final String[] args) {
        SpringApplication.run(AiServiceApplication.class, args);
    }

    @Bean
    AiTokenEstimator aiTokenEstimator() {
        return new ConservativeDeepSeekTokenEstimator();
    }
}
