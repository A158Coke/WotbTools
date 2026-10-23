package com.wotb.ai.review;

import com.wotb.ai.review.service.PlayerAiReviewService;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class PlayerAiReviewServiceTest {
    @Test void unresolvedRecorderIsRejectedBeforeTacticalAnalysis() {
        final TacticalReviewHarness harness = mock(TacticalReviewHarness.class);
        final PlayerAiReviewService service = new PlayerAiReviewService(harness);
        final Battle battle = new Battle();
        final ReplayReconstruction reconstruction = mock(ReplayReconstruction.class);
        org.mockito.Mockito.when(reconstruction.participants()).thenReturn(List.of());
        org.mockito.Mockito.when(reconstruction.events()).thenReturn(List.of());
        final var error = assertThrows(AiTimelineUnusableException.class, () -> service.analyze(battle, reconstruction,
                AllowedLanguage.ZH, AiReviewDonePayload.Capability.AVAILABLE, AiReviewStreamListener.NOOP));
        assertEquals(AiTimelineUnusableException.STABLE_ERROR_CODE + ":RECORDER_UNRESOLVED", error.getMessage());
        verifyNoInteractions(harness);
    }
}
