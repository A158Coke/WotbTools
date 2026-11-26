package com.wotb.ai.review.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

public final class AiEvalFixtures {
    private AiEvalFixtures() {
    }

    public static SingleTeamBattleAnalysisContext context(final String fixtureKey) {
        return AiEvalTeamFixtures.context(fixtureKey);
    }

    public record PlayerFixture(
            Battle battle,
            ReplayReconstruction recon,
            PlayerBattleFeatureSet features,
            RecorderEntityMapping recorder
    ) {
    }

    public static PlayerFixture playerFixture(final String fixtureKey) {
        final AiEvalPlayerFixtures.PlayerFixture fixture = AiEvalPlayerFixtures.playerFixture(fixtureKey);
        return new PlayerFixture(fixture.battle(), fixture.recon(), fixture.features(), fixture.recorder());
    }
}
