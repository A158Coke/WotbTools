package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.TeamPerspectiveLabelResolver;
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
 * 团队名册解析器：RosterEvidence 构建、覆盖度/Jaccard 校验、主导军团归一化与 display label。
 * <p>user-facing 名称只经 {@link #resolveDisplayLabel} /
 * {@link #resolveOpponentDisplayLabel} 输出——无可靠 clan（无 clan / 平票 / 非多数）时返回
 * 空串，由上层 fallback 到「我方/对方」；{@code 队伍-XXXX} 只保留在 core 的 internal
 * {@code resolveStableKey}，绝不进入 Prompt/UI。</p>
 * <p>从 {@link TeamReplayAnalysisService} 拆出，纯静态工具类，不做编排。</p>
 */
final class TeamRosterResolver {

    private TeamRosterResolver() {
    }

    static final double MIN_ROSTER_ACCOUNT_COVERAGE = 0.75;

    static List<String> rosterEvidenceLimits(final RosterEvidence evidence) {
        return evidence == null ? List.of() : evidence.limitations();
    }

    /**
     * 视角队伍的用户可见 display label：唯一 dominant 且严格多数（&gt; 一半）的 clan tag
     * （最常见 casing）；无可靠 clan 时返回空串（调用方 fallback 到「我方」）。
     * 绝不返回 {@code 队伍-XXXX}。
     */
    static String resolveDisplayLabel(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null) return "";
        final List<PlayerResult> perspectivePlayers = battle.players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "";
        return TeamPerspectiveLabelResolver.resolveDisplayLabel(perspectivePlayers);
    }

    /**
     * 对方队伍的用户可见 display label：独立解析（与视角队伍互不影响）；
     * 无可靠 clan 时返回空串（调用方 fallback 到「对方」）。绝不返回 {@code 队伍-XXXX}。
     */
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
