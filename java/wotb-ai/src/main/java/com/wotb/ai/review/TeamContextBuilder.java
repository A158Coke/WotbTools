package com.wotb.ai.review;

import com.wotb.core.replay.feature.DefaultTeamBattleFeatureExtractor;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.processing.BattleCategory;
import com.wotb.core.replay.processing.BattleCategoryUtils;
import com.wotb.core.replay.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.processing.BattleIdentity;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

final class TeamContextBuilder {

    private TeamContextBuilder() {
    }

    public static SingleTeamBattleAnalysisContext buildSingleTeamContext(
            final Battle battle, final ReplayReconstruction reconstruction) {
        if (battle == null) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        final String id = battle.arenaId != null && !battle.arenaId.isBlank()
                ? battle.arenaId : String.valueOf(battle.mapName) + ":" + battle.startTime;
        return buildSingleTeamContext(battle, reconstruction, id, battleIdentityOf(battle), "");
    }

    private static BattleIdentity battleIdentityOf(final Battle battle) {
        final String arenaId = blankToNull(battle.arenaId);
        if (arenaId != null) {
            return new BattleIdentity(arenaId, "", "", null);
        }
        final String mapCode = blankToNull(battle.mapName);
        return new BattleIdentity(null, mapCode != null ? mapCode : "",
                battle.clientVersion != null ? battle.clientVersion : "", battle.startTime);
    }

    private static String blankToNull(final String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static SingleTeamBattleAnalysisContext buildSingleTeamContext(
            final Battle battle, final ReplayReconstruction reconstruction,
            final String id, final BattleIdentity battleId, final String fileName) {
        final TeamPerspectiveResolution perspective = TeamPerspectiveResolver.resolve(battle, reconstruction);
        if (!perspective.resolved()) {
            throw new PerspectiveTeamNotResolvedException(unresolvedTeamCode(perspective));
        }
        final TeamBattleFeatureSet features = new DefaultTeamBattleFeatureExtractor()
                .extract(battle, reconstruction, perspective);
        if (!features.hasFeatures()) {
            throw new IllegalArgumentException("TEAM_FEATURES_UNAVAILABLE");
        }
        final BattleCategory category = BattleCategoryUtils.fromArenaBonusType(battle.arenaBonusType);
        return new SingleTeamBattleAnalysisContext(id, battleId, fileName, category, battle,
                perspective.perspectiveTeam(), features,
                reconstruction == null ? null : reconstruction.coverage(),
                features.limitations(), reconstruction);
    }

    private static String unresolvedTeamCode(
            final TeamPerspectiveResolution perspective
    ) {
        final boolean conflict = perspective.limitations().stream()
                .anyMatch(code -> "PERSPECTIVE_TEAM_CONFLICT".equals(code)
                        || "RECORDER_IDENTITY_CONFLICT".equals(code));
        return conflict
                ? "PERSPECTIVE_TEAM_CONFLICT"
                : "PERSPECTIVE_TEAM_UNRESOLVED";
    }

}
