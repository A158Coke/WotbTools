package com.wotb.ai.review;

import com.wotb.ai.review.service.AiReviewAnalysisService;
import com.wotb.ai.review.service.AiReviewExecutionService;
import com.wotb.ai.review.service.AiReviewSubmissionService;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AiReviewSubmissionServiceTest {
    @Test
    void acceptsValidRequestAndSchedulesWorker() {
        final AiReviewWorkerExecutor worker = mock(AiReviewWorkerExecutor.class);
        final var service = new AiReviewSubmissionService(worker, new AiCancellationRegistry(),
                mock(AiReviewExecutionService.class));
        assertNotNull(service.submit(request(UUID.randomUUID().toString())));
        verify(worker).execute(any(Runnable.class));
    }

    @Test
    void rejectsMissingReconstructionBeforeWorkerAdmission() {
        final AiReviewWorkerExecutor worker = mock(AiReviewWorkerExecutor.class);
        final var service = new AiReviewSubmissionService(worker, new AiCancellationRegistry(),
                mock(AiReviewExecutionService.class));
        final Battle battle = new Battle(); battle.arenaBonusType = 1; battle.players = List.of();
        final var error = assertThrows(ResponseStatusException.class, () -> service.submit(
                new AiReviewRequest(AllowedLanguage.ZH, UUID.randomUUID().toString(), battle, null, List.of())));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        assertEquals("INVALID_AI_REQUEST", error.getReason());
        verifyNoInteractions(worker);
    }

    @Test
    void unsupportedBattleCategoryIsRejectedBeforeEmitterAndWorkerAdmission() {
        final AiReviewWorkerExecutor worker = mock(AiReviewWorkerExecutor.class);
        final var service = new AiReviewSubmissionService(worker, new AiCancellationRegistry(),
                mock(AiReviewExecutionService.class));
        final AiReviewRequest request = request(UUID.randomUUID().toString());
        request.battle().arenaBonusType = Integer.MAX_VALUE;
        final var error = assertThrows(ResponseStatusException.class, () -> service.submit(request));
        assertEquals(HttpStatus.UNPROCESSABLE_CONTENT, error.getStatusCode());
        assertEquals("UNSUPPORTED_BATTLE_CATEGORY", error.getReason());
        verifyNoInteractions(worker);
    }

    @Test
    void duplicateCorrelationIdIsConflictAndWorkerSaturationIsUnavailable() {
        final AiCancellationRegistry registry = new AiCancellationRegistry();
        final String duplicateId = UUID.randomUUID().toString();
        registry.register(duplicateId);
        final AiReviewWorkerExecutor duplicateWorker = mock(AiReviewWorkerExecutor.class);
        final var duplicateService = new AiReviewSubmissionService(duplicateWorker, registry,
                mock(AiReviewExecutionService.class));
        final var conflict = assertThrows(ResponseStatusException.class,
                () -> duplicateService.submit(request(duplicateId)));
        assertEquals(HttpStatus.CONFLICT, conflict.getStatusCode());
        verifyNoInteractions(duplicateWorker);

        final AiReviewWorkerExecutor saturatedWorker = mock(AiReviewWorkerExecutor.class);
        doAnswer(invocation -> {
            throw new RejectedExecutionException();
        })
                .when(saturatedWorker).execute(any(Runnable.class));
        final var saturated = new AiReviewSubmissionService(saturatedWorker, new AiCancellationRegistry(),
                mock(AiReviewExecutionService.class));
        final var unavailable = assertThrows(ResponseStatusException.class,
                () -> saturated.submit(request(UUID.randomUUID().toString())));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, unavailable.getStatusCode());
        assertEquals("AI_REVIEW_BUSY", unavailable.getReason());
    }

    @Test
    void recordsMetricsForAcceptedReviewAndClassifiesStreamFailure() {
        final SimpleMeterRegistry registry = new SimpleMeterRegistry();
        final AiReviewAnalysisService analysis = mock(AiReviewAnalysisService.class);
        when(analysis.analyze(any(), any(), any(), any(), any(), any()))
                .thenThrow(new AiTimelineUnusableException("TIMELINE_CLOCK_UNRESOLVED"));
        final AiCancellationRegistry cancellations = new AiCancellationRegistry();
        final var execution = new AiReviewExecutionService(analysis, cancellations, registry);
        final AiReviewWorkerExecutor worker = mock(AiReviewWorkerExecutor.class);
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return null;
        })
                .when(worker).execute(any(Runnable.class));
        new AiReviewSubmissionService(worker, cancellations, execution).submit(request(UUID.randomUUID().toString()));
        assertEquals(1.0, registry.get("wotb_ai_review_requests_total").counter().count());
        assertEquals(1.0, registry.get("wotb_ai_review_results_total")
                .tag("result", "rejected").counter().count());
        assertEquals(1.0, registry.get("wotb_ai_review_errors_total")
                .tag("type", AiTimelineUnusableException.STABLE_ERROR_CODE).counter().count());
        assertEquals(1.0, registry.get("wotb_ai_review_duration_seconds").timer().count());
    }
    private static AiReviewRequest request(final String id) {
        final Battle battle = new Battle();
        battle.arenaBonusType = 2;
        battle.players = List.of();
        final ReplayReconstruction reconstruction = mock(ReplayReconstruction.class);
        when(reconstruction.participants()).thenReturn(List.of());
        when(reconstruction.events()).thenReturn(List.of());
        return new AiReviewRequest(AllowedLanguage.ZH, id, battle, reconstruction, List.of());
    }
}
