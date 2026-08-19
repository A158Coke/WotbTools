package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.timeline.TimelineError;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

/**
 * PR #102 review P0：{@code AiTimelineUnusableException} 的错误类型指标。
 * <p>非 Mockito：真实 {@link AiReplayReviewService} + 抛 {@code AiTimelineUnusableException}
 * 的假 facade + {@link SimpleMeterRegistry}，验证错误类型指标记录为固定稳定码
 * {@code AI_TIMELINE_UNUSABLE}（不引入高基数 label，不携带 detail），
 * 且结果计入 {@code rejected}。</p>
 */
class AiReplayReviewServiceTimelineUnusableMetricTest {

    @Test
    void timelineUnusableRecordsStableErrorTypeMetric_neverDetailCardinality() {
        final SimpleMeterRegistry registry = new SimpleMeterRegistry();
        final AiReplayReviewService service = serviceWithMetrics(registry,
                new ThrowingFacade(new AiTimelineUnusableException(
                        List.of(TimelineError.TIMELINE_CLOCK_UNRESOLVED, TimelineError.TIMELINE_META_INVALID))));

        assertThrows(AiTimelineUnusableException.class,
                () -> service.analyze(singleFile()));

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
        final AiReplayReviewService service = serviceWithMetrics(registry,
                new ThrowingFacade(new AiTimelineUnusableException("NO_RECONSTRUCTION")));

        assertThrows(AiTimelineUnusableException.class,
                () -> service.analyze(singleFile()));

        assertEquals(1.0, registry.counter(
                "wotb_ai_review_errors_total", "type", "AI_TIMELINE_UNUSABLE").count());
        assertEquals(0.0, registry.counter(
                "wotb_ai_review_errors_total", "type", "NO_RECONSTRUCTION").count());
        assertEquals(1.0, registry.counter(
                "wotb_ai_review_results_total", "result", "rejected").count());
    }

    /** 构造 service 并初始化 metrics（@PostConstruct 语义，否则 aiReviewDuration 为 null）。 */
    private static AiReplayReviewService serviceWithMetrics(final SimpleMeterRegistry registry,
                                                            final ThrowingFacade facade) {
        final AiReplayReviewService service = new AiReplayReviewService(facade, null, null, registry, null);
        service.initMetrics();
        return service;
    }

    private static MultipartFile[] singleFile() {
        return new MultipartFile[]{new MockMultipartFile(
                "files", "a.wotbreplay", "application/octet-stream", new byte[]{1})};
    }

    /** 抛 {@code AiTimelineUnusableException} 的假 facade（模拟 timeline 门禁拒绝）。 */
    private static final class ThrowingFacade extends DefaultReplayProcessingFacade {
        private final AiTimelineUnusableException failure;

        ThrowingFacade(final AiTimelineUnusableException failure) {
            this.failure = failure;
        }

        @Override
        public ReplayProcessingResult process(final Source input,
                                              final ReplayProcessingOptions options) {
            throw failure;
        }
    }
}
