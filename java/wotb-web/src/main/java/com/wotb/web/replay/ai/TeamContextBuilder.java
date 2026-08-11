package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleCategoryUtils;
import com.wotb.core.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.TeamPerspectiveResolution;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.feature.DefaultTeamBattleFeatureExtractor;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.MultiTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 团队分析上下文构建器：single/multi TeamBattleAnalysisContext 组装与未解析视角错误码。
 * <p>从 {@link TeamReplayAnalysisService} 拆出，纯静态工具类，不做编排。</p>
 */
final class TeamContextBuilder {

    private TeamContextBuilder() {
    }

    public static SingleTeamBattleAnalysisContext buildSingleTeamContext(
            final ReplayPerspectiveGroup group
    ) {
        if (group == null || group.representative() == null
                || group.representative().battle() == null) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        final ReplayProcessingResult representative = group.representative();
        final TeamPerspectiveResolution perspective = TeamPerspectiveResolver.resolve(
                representative.battle(), representative.reconstruction());
        if (!perspective.resolved()) {
            throw new PerspectiveTeamNotResolvedException(
                    unresolvedTeamCode(perspective));
        }
        final TeamBattleFeatureSet features = new DefaultTeamBattleFeatureExtractor().extract(
                representative.battle(), representative.reconstruction(), perspective);
        if (!features.hasFeatures()) {
            throw new IllegalArgumentException("TEAM_FEATURES_UNAVAILABLE");
        }
        final BattleCategory category = BattleCategoryUtils.fromArenaBonusType(
                representative.battle().arenaBonusType);
        return new SingleTeamBattleAnalysisContext(
                AnalysisUnitAssembler.analysisUnitId(group),
                group.battleIdentity(),
                representative.fileName(),
                category,
                representative.battle(),
                perspective.perspectiveTeam(),
                features,
                representative.reconstruction() != null
                        ? representative.reconstruction().coverage() : null,
                features.limitations(),
                representative.reconstruction());
    }

    static MultiTeamBattleAnalysisContext buildMultiTeamContext(
            final List<SingleTeamBattleAnalysisContext> contexts,
            final Map<String, TeamRosterResolver.RosterEvidence> evidenceByUnitId
    ) {
        final List<TeamBattleAnalysisSummary> summaries = contexts.stream()
                .map(context -> new TeamBattleAnalysisSummary(
                        context.analysisUnitId(),
                        context.battleId(),
                        context.fileName(),
                        context.battle() != null ? context.battle().mapName : null,
                        context.battleCategory(),
                        context.battle() != null
                                ? context.battle().durationS : null,
                        context.perspectiveTeam(),
                        context.features().members().stream()
                                .map(member -> member.accountId())
                                .filter(accountId -> accountId > 0)
                                .distinct()
                                .sorted()
                                .toList(),
                        context.features(),
                        TeamRosterResolver.resolveTeamLabel(
                                context.battle(), context.perspectiveTeam())))
                .toList();
        final int uniqueBattleCount = (int) summaries.stream()
                .map(TeamBattleAnalysisSummary::battleIdentity)
                .filter(id -> id != null)
                .distinct()
                .count();
        final boolean rosterConsistent = TeamRosterResolver.hasConsistentRoster(summaries);
        final List<String> limitations = new ArrayList<>();
        limitations.add("PERSPECTIVE_TIMELINES_ISOLATED");
        if (!rosterConsistent) {
            limitations.add("ROSTER_CONSISTENCY_UNCONFIRMED");
        }
        return new MultiTeamBattleAnalysisContext(
                summaries.size(), uniqueBattleCount, summaries, rosterConsistent, limitations);
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
