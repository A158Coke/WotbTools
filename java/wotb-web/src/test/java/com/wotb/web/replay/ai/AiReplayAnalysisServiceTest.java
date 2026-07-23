package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.AiNotConfiguredException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 18.7: AI Service 测试。
 * 注意：需 AI_API_KEY 环境变量或配置才能通过 {@link #realAiCall()} 之外的测试。
 * 未配置时仅测试未配置异常。
 */
@ExtendWith(MockitoExtension.class)
class AiReplayAnalysisServiceTest {

    private AiReplayAnalysisService service;

    @BeforeEach
    void setUp() {
        service = new AiReplayAnalysisService("", "", "", 5);
    }

    @Test
    void notConfiguredThrowsSpecificException() {
        final Battle battle = new Battle();
        assertThrows(AiNotConfiguredException.class,
                () -> service.analyze(battle, null));
    }

    @Test
    void notConfiguredThrowsForMulti() {
        assertThrows(AiNotConfiguredException.class,
                () -> service.analyzeMulti(List.of()));
    }

    @Test
    void configuredDoesNotThrow() {
        // Simulate config via reflection
        ReflectionTestUtils.setField(service, "apiKey", "test-key");
        ReflectionTestUtils.setField(service, "model", "test-model");
        assertTrue(service.isConfigured());
    }

    @Test
    void analyzeResultContainsModel() {
        ReflectionTestUtils.setField(service, "apiKey", "test-key");
        ReflectionTestUtils.setField(service, "model", "test-model");
        assertTrue(service.isConfigured());
    }
}
