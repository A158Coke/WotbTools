package com.wotb.ai.review;

import com.wotb.ai.review.service.AiReviewAnalysisService;
import com.wotb.ai.review.service.PlayerAiReviewService;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.ReplayAnalysisScope;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AiReviewAnalysisServiceTest {
    @Test
    void routesPlayerFocusedReviewToPlayerService() {
        final PlayerAiReviewService player = mock(PlayerAiReviewService.class);
        final TeamReplayAnalysisService team = mock(TeamReplayAnalysisService.class);
        final AiReviewDonePayload expected = new AiReviewDonePayload("player", null,
                AiReviewDonePayload.Capability.AVAILABLE, null, List.of());
        when(player.analyze(any(), any(), any(), any(), any())).thenReturn(expected);
        final var service = new AiReviewAnalysisService(player, team);
        assertEquals(expected, service.analyze(new Battle(), mock(ReplayReconstruction.class), AllowedLanguage.EN,
                ReplayAnalysisScope.PLAYER_FOCUSED, AiReviewDonePayload.Capability.AVAILABLE,
                AiReviewStreamListener.NOOP));
        verify(player).analyze(any(), any(), any(), any(), any());
        verifyNoInteractions(team);
    }

    @Test
    void teamBranchPreservesTeamResultAndAddsRequestCapability() {
        final PlayerAiReviewService player = mock(PlayerAiReviewService.class);
        final TeamReplayAnalysisService team = mock(TeamReplayAnalysisService.class);
        final AiReviewDonePayload teamPayload = new AiReviewDonePayload("team", "pre", null,
                new com.wotb.core.replay.evidence.TeamAiReviewResult(null, List.of(), List.of(), List.of(), List.of()),
                List.of());
        when(team.analyzeTeam(any(), any(), any(), any())).thenReturn(teamPayload);
        final var service = new AiReviewAnalysisService(player, team);
        final var result = service.analyze(new Battle(), mock(ReplayReconstruction.class), AllowedLanguage.RU,
                ReplayAnalysisScope.TEAM_PERSPECTIVE, AiReviewDonePayload.Capability.AVAILABLE_WITH_LIMITED_TIMELINE,
                AiReviewStreamListener.NOOP);
        assertEquals("team", result.analysis());
        assertEquals("pre", result.preBattleSection());
        assertEquals(AiReviewDonePayload.Capability.AVAILABLE_WITH_LIMITED_TIMELINE, result.capability());
        verifyNoInteractions(player);
    }
}
