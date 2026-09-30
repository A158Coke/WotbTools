package com.wotb.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.TacticalReviewHarness;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AiReviewControllerTest {
    private final AiReviewWorkerExecutor worker = mock(AiReviewWorkerExecutor.class);
    private final AiReviewController controller = new AiReviewController(
            mock(TacticalReviewHarness.class), mock(AiReplayAnalysisService.class), worker,
            new AiCancellationRegistry());

    @Test
    void rejectsUnsupportedSchemaBeforeStartingWorker() {
        final var error = assertThrows(ResponseStatusException.class,
                () -> controller.review(new AiReviewController.AiReviewRequestV1(
                        2, "zh-CN", UUID.randomUUID().toString(), new Battle(),
                        mock(ReplayReconstruction.class))));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        assertEquals("UNSUPPORTED_AI_REQUEST_SCHEMA", error.getReason());
    }

    @Test
    void acceptsTeamModeAndSchedulesDirectAnalysis() {
        final Battle battle = new Battle();
        battle.arenaBonusType = 2;
        battle.players = List.of();
        final ReplayReconstruction reconstruction = mock(ReplayReconstruction.class);
        when(reconstruction.participants()).thenReturn(List.of());
        when(reconstruction.events()).thenReturn(List.of());
        when(reconstruction.coverage()).thenReturn(mock(ReplayCoverage.class));
        final var emitter = controller.review(new AiReviewController.AiReviewRequestV1(
                1, "zh-CN", UUID.randomUUID().toString(), battle, reconstruction));
        org.junit.jupiter.api.Assertions.assertNotNull(emitter);
        org.mockito.Mockito.verify(worker).execute(org.mockito.ArgumentMatchers.any(Runnable.class));
    }

    @Test
    void rejectsMissingReconstructionFactsBeforeStartingWorker() {
        final Battle battle = new Battle();
        battle.arenaBonusType = 1;
        battle.players = List.of();
        final var error = assertThrows(ResponseStatusException.class,
                () -> controller.review(new AiReviewController.AiReviewRequestV1(
                        1, "zh-CN", UUID.randomUUID().toString(), battle,
                        mock(ReplayReconstruction.class))));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        assertEquals("INVALID_AI_REQUEST", error.getReason());
    }
}
