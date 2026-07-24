package com.wotb.core.replay.feature;

import com.wotb.core.processing.BattleIdentity;
import com.wotb.core.replay.reconstruction.ReplayCoverage;

import java.util.List;

/**
 * 单场训练房/联赛队伍视角 AI 分析上下文。
 */
public record SingleTeamBattleAnalysisContext(
        BattleIdentity battleId,
        int perspectiveTeam,
        TeamBattleFeatureSet features,
        ReplayCoverage coverage,
        List<String> limitations
) {
}
