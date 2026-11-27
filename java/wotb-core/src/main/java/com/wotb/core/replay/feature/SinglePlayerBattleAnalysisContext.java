package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.BattleIdentity;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayCoverage;

import java.util.List;

public record SinglePlayerBattleAnalysisContext(
        BattleIdentity battleId,
        Battle battle,
        PlayerBattleFeatureSet features,
        RecorderEntityMapping recorder,
        ReplayCoverage coverage,
        List<String> limitations
) {
}
