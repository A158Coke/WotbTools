package com.wotb.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.TacticalReviewHarness;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiReviewControllerTest {
    private final AiReviewWorkerExecutor worker = mock(AiReviewWorkerExecutor.class);
    private final AiReviewController controller = new AiReviewController(
            mock(TacticalReviewHarness.class), mock(AiReplayAnalysisService.class), worker,
            new AiCancellationRegistry(), new SimpleMeterRegistry());

    @Test
    void acceptsTeamModeAndSchedulesDirectAnalysis() {
        final var emitter = controller.review(new AiReviewController.AiReviewRequest("zh-CN", UUID.randomUUID().toString(), teamBattle(), teamReconstruction(), List.of()));
        assertNotNull(emitter);
        verify(worker).execute(any(Runnable.class));
    }

    @Test
    void rejectsMissingReconstructionFactsBeforeStartingWorker() {
        final Battle battle = new Battle();
        battle.arenaBonusType = 1;
        battle.players = List.of();
        final var error = assertThrows(ResponseStatusException.class,
                () -> controller.review(new AiReviewController.AiReviewRequest("zh-CN", UUID.randomUUID().toString(), battle, null, List.of())));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        assertEquals("INVALID_AI_REQUEST", error.getReason());
    }

    /**
     * 生产看板/告警依赖的 Review 指标必须由 ai-service 的 controller 边界产出
     * （docs/operations/observability.md §10）：{@code requests_total} 每次进入 worker +1，
     * {@code results_total{result}} 区分成功/失败/事实校验退回，
     * {@code errors_total{type}} 只记流内失败分类，{@code duration_seconds} 成功与异常都结束。
     */
    @Test
    void recordsReviewMetricsClassifiedByStreamFailure() {
        final SimpleMeterRegistry registry = new SimpleMeterRegistry();
        final AiReviewAnalysisServiceStub stub = new AiReviewAnalysisServiceStub();
        stub.failure = new AiTimelineUnusableException("TIMELINE_CLOCK_UNRESOLVED");
        final AiReviewController metricsController = new AiReviewController(
                mock(TacticalReviewHarness.class), stub.service, synchronousWorker(),
                new AiCancellationRegistry(), registry);

        metricsController.review(new AiReviewController.AiReviewRequest("zh-CN", UUID.randomUUID().toString(), teamBattle(), teamReconstruction(), List.of()));

        assertEquals(1.0, registry.get("wotb_ai_review_requests_total").counter().count(),
                "each accepted review must increment requests_total");
        assertEquals(1.0, registry.get("wotb_ai_review_results_total")
                        .tag("result", "rejected").counter().count(),
                "timeline-unusable is an in-stream rejection, not a failure");
        assertEquals(1.0, registry.get("wotb_ai_review_errors_total")
                        .tag("type", AiTimelineUnusableException.STABLE_ERROR_CODE).counter().count(),
                "error classification must use the stable error code");
        assertEquals(1.0, registry.get("wotb_ai_review_duration_seconds").timer().count(),
                "duration timer must stop on the failure path too");
    }

    private static AiReviewWorkerExecutor synchronousWorker() {
        final AiReviewWorkerExecutor executor = mock(AiReviewWorkerExecutor.class);
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return null;
        }).when(executor).execute(any(Runnable.class));
        return executor;
    }

    private static Battle teamBattle() {
        final Battle battle = new Battle();
        battle.arenaBonusType = 2;
        battle.players = List.of();
        return battle;
    }

    private static ReplayReconstruction teamReconstruction() {
        final ReplayReconstruction reconstruction = mock(ReplayReconstruction.class);
        when(reconstruction.participants()).thenReturn(List.of());
        when(reconstruction.events()).thenReturn(List.of());
        return reconstruction;
    }

    /** 让 team 分支在 worker 线程内确定性失败，用于验证指标分类。 */
    private static final class AiReviewAnalysisServiceStub {
        private final AiReplayAnalysisService service = mock(AiReplayAnalysisService.class);
        private RuntimeException failure;

        private AiReviewAnalysisServiceStub() {
            when(service.analyzeTeam(any(), any(), any(), any())).thenAnswer(invocation -> {
                throw failure;
            });
        }
    }
}
