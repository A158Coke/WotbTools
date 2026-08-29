package com.wotb.core.replay.processing;

import com.wotb.core.model.Source;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * 处理门面 live 单文件 {@link DefaultReplayProcessingFacade#process} 契约单元测试。
 * 有效回放的单场/多场覆盖属于集成/探针测试（需真实样本 fixture，见
 * {@code MapOverviewBuilderTest} / {@code ReplayFactsCodecTest} 等）。
 */
class DefaultReplayProcessingFacadeTest {

    private final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();

    private static Source src(final String name, final byte... bytes) {
        return new Source(name, bytes);
    }

    @Test
    void garbageIsNotAnalyzable_returnsFailed() {
        final ReplayProcessingResult r = facade.process(
                src("a.wotbreplay", (byte) 1, (byte) 2, (byte) 3),
                ReplayProcessingOptions.full());

        assertEquals(ReplayProcessingStatus.FAILED, r.status());
        assertEquals("SUMMARY_PARSE_FAILED", r.error().code());
        assertNotNull(r.capabilities());
        assertFalse(r.capabilities().recorderResultAvailable(), "garbage must not be AI-analyzable");
    }

    @Test
    void invalidExtensionFailsValidation() {
        final ReplayProcessingResult r = facade.process(
                src("a.txt", (byte) 1, (byte) 2, (byte) 3),
                ReplayProcessingOptions.full());

        assertEquals(ReplayProcessingStatus.FAILED, r.status());
        assertEquals("FILE_VALIDATION_FAILED", r.error().code());
    }
}
