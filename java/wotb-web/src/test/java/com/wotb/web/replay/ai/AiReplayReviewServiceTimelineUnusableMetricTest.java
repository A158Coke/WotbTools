package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.timeline.TimelineError;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/**
 * PR #102 review P0：{@code AiTimelineUnusableException} 的错误类型指标。
 * <p>真实 {@link AiReplayReviewService} + 抛 {@code AiTimelineUnusableException}
 * 的 AI 分析 mock + {@link SimpleMeterRegistry}，验证错误类型指标记录为固定稳定码
 * {@code AI_TIMELINE_UNUSABLE}（不引入高基数 label，不携带 detail），
 * 且结果计入 {@code rejected}。</p>
 */
class AiReplayReviewServiceTimelineUnusableMetricTest {

    @Test
    void timelineUnusableRecordsStableErrorTypeMetric_neverDetailCardinality() {
        final SimpleMeterRegistry registry = new SimpleMeterRegistry();
        final AiReplayAnalysisService aiService = Mockito.mock(AiReplayAnalysisService.class);
        when(aiService.analyzePlayerOrFallback(any(), eq(AllowedLanguage.ZH), any()))
                .thenThrow(new AiTimelineUnusableException(
                        List.of(TimelineError.TIMELINE_CLOCK_UNRESOLVED, TimelineError.TIMELINE_META_INVALID)));
        final AiReplayReviewService service = serviceWithMetrics(registry, aiService);

        assertThrows(AiTimelineUnusableException.class,
                () -> service.analyzeFacts(facts(), AllowedLanguage.ZH, AiReviewStreamListener.NOOP));

        // 错误类型指标按稳定码记录（低基数固定值）
        assertEquals(1.0, registry.counter(
                "wotb_ai_review_errors_total", "type", "AI_TIMELINE_UNUSABLE").count());
        // detail 绝不进入 label（无高基数 / 无 TIMELINE_* 值）
        assertEquals(0.0, registry.counter(
                "wotb_ai_review_errors_total", "type", "AI_TIMELINE_UNUSABLE:TIMELINE_CLOCK_UNRESOLVED").count());
        assertEquals(0.0, registry.counter(
                "wotb_ai_review_errors_total", "type", "TIMELINE_CLOCK_UNRESOLVED").count());
        // 结果类别计入 rejected（与其它拒绝路径一致）
        assertEquals(1.0, registry.counter(
                "wotb_ai_review_results_total", "result", "rejected").count());
    }

    @Test
    void timelineUnusableNoReconstructionVariantStillRecordsStableType() {
        final SimpleMeterRegistry registry = new SimpleMeterRegistry();
        final AiReplayAnalysisService aiService = Mockito.mock(AiReplayAnalysisService.class);
        when(aiService.analyzePlayerOrFallback(any(), eq(AllowedLanguage.ZH), any()))
                .thenThrow(new AiTimelineUnusableException("NO_RECONSTRUCTION"));
        final AiReplayReviewService service = serviceWithMetrics(registry, aiService);

        assertThrows(AiTimelineUnusableException.class,
                () -> service.analyzeFacts(facts(), AllowedLanguage.ZH, AiReviewStreamListener.NOOP));

        assertEquals(1.0, registry.counter(
                "wotb_ai_review_errors_total", "type", "AI_TIMELINE_UNUSABLE").count());
        assertEquals(0.0, registry.counter(
                "wotb_ai_review_errors_total", "type", "NO_RECONSTRUCTION").count());
        assertEquals(1.0, registry.counter(
                "wotb_ai_review_results_total", "result", "rejected").count());
    }

    /** 构造 service 并初始化 metrics（@PostConstruct 语义，否则 aiReviewDuration 为 null）。 */
    private static AiReplayReviewService serviceWithMetrics(final SimpleMeterRegistry registry,
                                                            final AiReplayAnalysisService aiService) {
        final AiReplayReviewService service = new AiReplayReviewService(aiService, null, registry);
        service.initMetrics();
        return service;
    }

    /** 最小随机战 facts（含 battle/capabilities，足以进入 AI 调用链）。 */
    private static AiReplayFacts facts() {
        final Battle battle = new Battle();
        battle.arenaId = "random-arena";
        battle.mapName = "random_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = "Player";
        final PlayerResult p = new PlayerResult();
        p.accountId = 1001L;
        p.nickname = "Player";
        p.team = 1;
        p.tankId = 4481L;
        p.survived = true;
        battle.players = List.of(p);
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        return AiReplayFacts.fromResult(new ReplayProcessingResult(
                "random.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("h", "random-arena", "11.0", "random_map", 1001L, null),
                battle, null, null, capabilities, null, null));
    }
}
