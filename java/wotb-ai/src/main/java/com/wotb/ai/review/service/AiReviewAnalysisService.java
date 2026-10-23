package com.wotb.ai.review.service;

import com.wotb.ai.review.AiReviewDonePayload;
import com.wotb.ai.review.AiReviewStreamListener;
import com.wotb.ai.review.AllowedLanguage;
import com.wotb.ai.review.TeamReplayAnalysisService;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.ReplayAnalysisScope;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.springframework.stereotype.Service;

@Service
public class AiReviewAnalysisService {
    private final PlayerAiReviewService playerReviewService;
    private final TeamReplayAnalysisService teamReviewService;

    public AiReviewAnalysisService(final PlayerAiReviewService playerReviewService,
                                  final TeamReplayAnalysisService teamReviewService) {
        this.playerReviewService = playerReviewService;
        this.teamReviewService = teamReviewService;
    }

    public AiReviewDonePayload analyze(final Battle battle, final ReplayReconstruction reconstruction,
                                       final AllowedLanguage language, final ReplayAnalysisScope scope,
                                       final AiReviewDonePayload.Capability capability,
                                       final AiReviewStreamListener listener) {
        if (scope == ReplayAnalysisScope.PLAYER_FOCUSED) {
            return playerReviewService.analyze(battle, reconstruction, language, capability, listener);
        }
        final AiReviewDonePayload team = teamReviewService.analyzeTeam(battle, reconstruction, language, listener);
        return new AiReviewDonePayload(team.analysis(), team.preBattleSection(), capability,
                team.teamReview(), team.teamPlayers());
    }
}
