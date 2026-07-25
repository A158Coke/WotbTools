package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleIdentity;
import com.wotb.core.replay.reconstruction.ReplayCoverage;

import java.util.List;

/**
 * 单场训练房/联赛队伍视角 AI 分析上下文。
 */
public record SingleTeamBattleAnalysisContext(
        String analysisUnitId,
        BattleIdentity battleId,
        String fileName,
        BattleCategory battleCategory,
        Battle battle,
        int perspectiveTeam,
        TeamBattleFeatureSet features,
        ReplayCoverage coverage,
        List<String> limitations
) {

    public SingleTeamBattleAnalysisContext {
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }
}
