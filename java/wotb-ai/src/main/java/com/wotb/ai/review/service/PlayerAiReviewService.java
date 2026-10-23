package com.wotb.ai.review.service;

import com.wotb.ai.review.AiReviewDonePayload;
import com.wotb.ai.review.AiReviewStreamListener;
import com.wotb.ai.review.AllowedLanguage;
import com.wotb.ai.review.AnalysisUnitAssembler;
import com.wotb.ai.review.AiTimelineUnusableException;
import com.wotb.ai.review.PlayerReviewOutputCorrector;
import com.wotb.ai.review.PreBattleSectionRenderer;
import com.wotb.ai.review.TacticalReviewHarness;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.TimelinePerspective;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class PlayerAiReviewService {
    private final TacticalReviewHarness tacticalReviewHarness;

    public PlayerAiReviewService(final TacticalReviewHarness tacticalReviewHarness) {
        this.tacticalReviewHarness = tacticalReviewHarness;
    }

    public AiReviewDonePayload analyze(final Battle battle, final ReplayReconstruction reconstruction,
                                       final AllowedLanguage language, final AiReviewDonePayload.Capability capability,
                                       final AiReviewStreamListener listener) {
        final var recorder = AnalysisUnitAssembler.findRecorder(battle, reconstruction);
        if (recorder.accountId() == null || recorder.team() == null) {
            throw new AiTimelineUnusableException("RECORDER_UNRESOLVED");
        }
        final var timeline = BattleTimelineBuilder.build(battle, reconstruction,
                TimelinePerspective.personal(recorder.accountId(), recorder.team()));
        if (!timeline.usable()) {
            throw new AiTimelineUnusableException(timeline.validation().errors());
        }
        final TacticalReviewHarness.HarnessOutcome outcome = tacticalReviewHarness.analyzeWithPrior(
                battle, reconstruction, language, listener);
        final String preBattleSection = outcome.preBattlePrior() == null ? null
                : PreBattleSectionRenderer.renderRandomBattle(outcome.preBattlePrior(),
                        recorder.team(), language, battle.mapName);
        final PlayerReviewOutputCorrector.Corrected corrected = PlayerReviewOutputCorrector.apply(
                outcome.result().analysis(), preBattleSection, battle, language);
        return new AiReviewDonePayload(corrected.analysis(), corrected.preBattleSection(), capability, null, List.of());
    }
}
