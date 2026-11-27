package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.ref.ReplayDisplayNames;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

final class TeamRosterResolver {

    private TeamRosterResolver() {
    }

    static final double MIN_ROSTER_ACCOUNT_COVERAGE = 0.75;

    static List<String> rosterEvidenceLimits(final RosterEvidence evidence) {
        return evidence == null ? List.of() : evidence.limitations();
    }

    static List<AiReviewDonePayload.TeamPlayer> playerIdentities(
            final SingleTeamBattleAnalysisContext ctx) {
        if (ctx == null || ctx.features() == null) return List.of();
        final List<TeamMemberFeatureSet> members = ctx.features().members().stream()
                .filter(member -> member != null && member.accountId() > 0)
                .sorted(Comparator.comparingLong(TeamMemberFeatureSet::accountId)
                        .thenComparing(TeamMemberFeatureSet::nickname,
                                Comparator.nullsLast(String::compareTo)))
                .toList();
        final List<AiReviewDonePayload.TeamPlayer> result = new ArrayList<>(members.size());
        for (int index = 0; index < members.size(); index++) {
            final TeamMemberFeatureSet member = members.get(index);
            result.add(new AiReviewDonePayload.TeamPlayer(
                    "P" + (index + 1),
                    member.nickname() == null ? "" : member.nickname(),
                    ReplayDisplayNames.tankName(member.tankId(), member.tankName())));
        }
        return List.copyOf(result);
    }

    static Set<String> playerKeys(final SingleTeamBattleAnalysisContext ctx) {
        return playerIdentities(ctx).stream()
                .map(AiReviewDonePayload.TeamPlayer::playerKey)
                .collect(Collectors.toUnmodifiableSet());
    }

    static String resolveDisplayLabel(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null) return "";
        final List<PlayerResult> perspectivePlayers = battle.players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "";
        return TeamPerspectiveLabelResolver.resolveDisplayLabel(perspectivePlayers);
    }

    static String resolveOpponentDisplayLabel(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null) return "";
        final List<PlayerResult> opponents = battle.players.stream()
                .filter(p -> com.wotb.core.replay.processing.PlayerSideResolver.isValidRawTeam(p.team)
                        && p.team != perspectiveTeam)
                .toList();
        if (opponents.isEmpty()) return "";
        return TeamPerspectiveLabelResolver.resolveDisplayLabel(opponents);
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
