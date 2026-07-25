package com.wotb.core.replay.feature;

import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleIdentity;

import java.util.List;

/** 单场队伍视角分析摘要（多场趋势用）。 */
public record TeamBattleAnalysisSummary(
        String analysisUnitId,
        BattleIdentity battleIdentity,
        String fileName,
        String mapName,
        BattleCategory battleCategory,
        Double durationSec,
        int perspectiveTeam,
        List<Long> rosterAccountIds,
        TeamBattleFeatureSet features
) {

    public TeamBattleAnalysisSummary {
        rosterAccountIds = rosterAccountIds == null ? List.of() : List.copyOf(rosterAccountIds);
    }
}
