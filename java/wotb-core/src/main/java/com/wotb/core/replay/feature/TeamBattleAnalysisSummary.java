package com.wotb.core.replay.feature;

import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleIdentity;

import java.util.List;

/**
 * Lightweight summary for a single team-perspective battle.
 * {@code teamLabel} is a user-visible name derived from dominant clan
 * (e.g., "CHRD") or a stable fallback.
 */
public record TeamBattleAnalysisSummary(
        String analysisUnitId,
        BattleIdentity battleIdentity,
        String fileName,
        String mapName,
        BattleCategory battleCategory,
        Double durationSec,
        int perspectiveTeam,
        List<Long> rosterAccountIds,
        TeamBattleFeatureSet features,
        String teamLabel
) {
    public TeamBattleAnalysisSummary {
        rosterAccountIds = rosterAccountIds == null ? List.of() : List.copyOf(rosterAccountIds);
    }
}
