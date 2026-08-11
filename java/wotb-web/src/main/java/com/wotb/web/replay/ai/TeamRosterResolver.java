package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
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

    static final double MIN_ROSTER_JACCARD = 0.60;
    static final double MIN_ROSTER_ACCOUNT_COVERAGE = 0.75;

    static List<String> rosterEvidenceLimits(final RosterEvidence evidence) {
        return evidence == null ? List.of() : evidence.limitations();
    }

    static String normalizedDominantClan(
            final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null) return "";
        final List<PlayerResult> perspectivePlayers = battle.players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        return TeamPerspectiveLabelResolver.resolveDominantClanTag(perspectivePlayers);
    }

    static String resolveTeamLabel(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null) return "未知队伍";
        final List<PlayerResult> perspectivePlayers = battle.players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "未知队伍";
        return TeamPerspectiveLabelResolver.resolve(perspectivePlayers);
    }

    static boolean hasConsistentRoster(
            final List<TeamBattleAnalysisSummary> summaries
    ) {
        if (summaries.size() <= 1) {
            return true;
        }
        if (summaries.stream().anyMatch(
                summary -> !hasSufficientRosterCoverage(summary))) {
            return false;
        }
        final Set<Long> reference = validRoster(summaries.getFirst());
        if (reference.isEmpty()) {
            return false;
        }
        final List<Set<Long>> rosters = summaries.stream()
                .map(TeamRosterResolver::validRoster)
                .toList();
        for (int left = 0; left < rosters.size(); left++) {
            for (int right = left + 1; right < rosters.size(); right++) {
                if (jaccard(rosters.get(left), rosters.get(right))
                        < MIN_ROSTER_JACCARD) {
                    return false;
                }
            }
        }
        return true;
    }

    static boolean hasSufficientRosterCoverage(
            final TeamBattleAnalysisSummary summary
    ) {
        final Set<Long> roster = validRoster(summary);
        final int expectedMembers = expectedRosterSize(summary);
        return expectedMembers > 0
                && (double) roster.size() / expectedMembers
                        >= MIN_ROSTER_ACCOUNT_COVERAGE;
    }

    static int expectedRosterSize(
            final TeamBattleAnalysisSummary summary
    ) {
        if (summary.features() == null) {
            return 0;
        }
        if (summary.features().authoritativeAggregate() != null) {
            return summary.features().authoritativeAggregate().memberCount();
        }
        return summary.features().members().size();
    }

    static Set<Long> validRoster(
            final TeamBattleAnalysisSummary summary
    ) {
        return summary.rosterAccountIds().stream()
                .filter(accountId -> accountId != null && accountId > 0)
                .collect(Collectors.toCollection(
                        LinkedHashSet::new));
    }

    static double jaccard(final Set<Long> left, final Set<Long> right) {
        final Set<Long> intersection = new HashSet<>(left);
        intersection.retainAll(right);
        final Set<Long> union = new HashSet<>(left);
        union.addAll(right);
        return union.isEmpty() ? 0.0 : (double) intersection.size() / union.size();
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
