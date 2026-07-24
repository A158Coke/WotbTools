package com.wotb.core.processing;

import com.wotb.core.model.Source;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * 处理门面的能力标记与模式判断（失败/去重侧，不依赖真实回放样本）。
 * 有效回放的单场/多场覆盖属于集成测试（需样本 fixture）。
 */
class DefaultReplayProcessingFacadeTest {

    private final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();

    private static Source src(String name, byte... bytes) {
        return new Source(name, bytes);
    }

    @Test
    void garbageIsNotAnalyzable_modeNone() {
        final ReplayBatchProcessingResult r = facade.processBatch(
                List.of(src("a.wotbreplay", (byte) 1, (byte) 2, (byte) 3)),
                ReplayProcessingOptions.full());

        assertEquals(ReplayAnalysisMode.NONE, r.suggestedAnalysisMode());
        final ReplayProcessingResult one = r.results().get(0);
        assertEquals(ReplayProcessingStatus.FAILED, one.status());
        assertNotNull(one.capabilities());
        assertFalse(one.capabilities().recorderResultAvailable(), "garbage must not be AI-analyzable");
    }

    @Test
    void identicalContentIsDeduped() {
        final byte[] same = {9, 8, 7, 6, 5};
        final ReplayBatchProcessingResult r = facade.processBatch(
                List.of(new Source("a.wotbreplay", same), new Source("b.wotbreplay", same)),
                ReplayProcessingOptions.full());

        assertEquals(2, r.results().size());
        assertEquals("DUPLICATE_FILE", r.results().get(1).error().code());
        // 均不可分析 → 模式 NONE
        final long analyzable = r.results().stream()
                .filter(x -> x.capabilities() != null && x.capabilities().recorderResultAvailable())
                .count();
        assertEquals(0, analyzable);
        assertEquals(ReplayAnalysisMode.NONE, r.suggestedAnalysisMode());
    }
}
