package com.wotb.ai.review.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * AI 复盘评估 golden fixtures：synthetic 7v7 训练房/联赛（争霸赛）场景。
 * <p>坐标语义：raw 回放坐标（±250 → canonical 0..500），移动段 distance 为 canonical 米；
 * 阵型簇成员身份使用 {@code account:<accountId>}（与 {@code DefaultTeamBattleFeatureExtractor.identityKey} 一致）。</p>
 */
public final class AiEvalFixtures {
    private AiEvalFixtures() {
    }

    public static SingleTeamBattleAnalysisContext context(final String fixtureKey) {
        return AiEvalTeamFixtures.context(fixtureKey);
    }

    /** player 路径 fixture：battle + recon + features + recorder（供 AiEvalPromptProbe 走真实证据链）。 */
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
