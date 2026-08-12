package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 团队名册解析器：RosterEvidence 构建、覆盖度/Jaccard 校验、主导军团归一化与 teamLabel。
 * <p>从 {@link TeamReplayAnalysisService} 拆出，纯静态工具类，不做编排。</p>
 */
final class TeamRosterResolver {

    private TeamRosterResolver() {
    }

    static final double MIN_ROSTER_ACCOUNT_COVERAGE = 0.75;

    static List<String> rosterEvidenceLimits(final RosterEvidence evidence) {
        return evidence == null ? List.of() : evidence.limitations();
    }

    static String resolveTeamLabel(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null) return "未知队伍";
        final List<PlayerResult> perspectivePlayers = battle.players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "未知队伍";
        return TeamPerspectiveLabelResolver.resolve(perspectivePlayers);
    }

    record RosterEvidence(
        int expectedMemberCount,
        Set<Long> distinctValidAccountIds,
        double coverageRatio,
        boolean sufficientCoverage,
        List<String> limitations
    ) {
        static RosterEvidence from(final SingleTeamBattleAnalysisContext ctx) {
            final TeamBattleFeatureSet features = ctx.features();
            if (features == null) return empty();
            final int expected = features.authoritativeAggregate() != null
                ? features.authoritativeAggregate().memberCount()
                : features.members().size();
            if (expected <= 0) return empty();
            final Set<Long> distinctValid = features.members().stream()
                .map(TeamMemberFeatureSet::accountId)
                .filter(id -> id > 0)
                .collect(Collectors.toCollection(LinkedHashSet::new));
            final long totalPositive = features.members().stream()
                .map(TeamMemberFeatureSet::accountId)
                .filter(id -> id > 0)
                .count();
            final List<String> limits = new ArrayList<>();
            if (totalPositive > distinctValid.size()) {
                limits.add("DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS");
            }
            final double ratio = Math.min((double) distinctValid.size() / expected, 1.0);
            return new RosterEvidence(expected, Collections.unmodifiableSet(distinctValid),
                ratio, ratio >= MIN_ROSTER_ACCOUNT_COVERAGE, Collections.unmodifiableList(limits));
        }

        static RosterEvidence empty() {
            return new RosterEvidence(0, Set.of(), 0.0, false, List.of());
        }
    }

}
