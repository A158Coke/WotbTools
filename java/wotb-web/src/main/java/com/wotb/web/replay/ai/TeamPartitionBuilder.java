package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.BattleIdentity;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;

import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.IntStream;

/**
 * 团队分析分区器：基于 RosterEvidence 的确定性 complete-link 兼容分区（stable/permutation-safe）。
 * <p>从 {@link TeamReplayAnalysisService} 拆出，纯静态工具类，不做编排。</p>
 */
final class TeamPartitionBuilder {

    private TeamPartitionBuilder() {
    }

    private record IndexedContext(
            SingleTeamBattleAnalysisContext ctx, int originalIndex, TeamRosterResolver.RosterEvidence evidence) {
    }

    static List<List<SingleTeamBattleAnalysisContext>> buildPartitions(
            final List<SingleTeamBattleAnalysisContext> contexts,
            final Map<String, TeamRosterResolver.RosterEvidence> evidenceByUnitId) {
        if (contexts.size() <= 1) {
            return List.of(contexts);
        }
        final List<IndexedContext> indexed = new ArrayList<>();
        for (int index = 0; index < contexts.size(); index++) {
            indexed.add(new IndexedContext(contexts.get(index), index,
                    evidenceByUnitId.get(contexts.get(index).analysisUnitId())));
        }
        final List<IndexedContext> sorted = new ArrayList<>(indexed);
        sorted.sort(Comparator.comparing((final IndexedContext ic) -> {
            final BattleIdentity bid = ic.ctx.battleId();
            return (bid != null ? bid.toString() : "") + "|" + ic.ctx.analysisUnitId();
        }));
        final List<List<IndexedContext>> indexedPartitions = new ArrayList<>();
        for (final var ic : sorted) {
            boolean added = false;
            for (final var ip : indexedPartitions) {
                if (canJoinPartition(ic, ip)) {
                    ip.add(ic);
                    added = true;
                    break;
                }
            }
            if (!added) {
                final List<IndexedContext> newPartition = new ArrayList<>();
                newPartition.add(ic);
                indexedPartitions.add(newPartition);
            }
        }
        final List<List<SingleTeamBattleAnalysisContext>> result = new ArrayList<>();
        final List<Integer> minIndices = new ArrayList<>();
        for (final var ip : indexedPartitions) {
            ip.sort(Comparator.comparingInt(IndexedContext::originalIndex));
            minIndices.add(ip.getFirst().originalIndex());
            result.add(ip.stream().map(IndexedContext::ctx).toList());
        }
        return IntStream.range(0, result.size())
                .boxed()
                .sorted(Comparator.comparingInt(minIndices::get))
                .map(result::get)
                .toList();
    }

    static boolean canJoinPartition(
            final IndexedContext candidate,
            final List<IndexedContext> partition) {
        for (final var existing : partition) {
            if (!contextsCompatible(candidate, existing)) {
                return false;
            }
        }
        return true;
    }

    static boolean contextsCompatible(final IndexedContext a, final IndexedContext b) {
        final TeamRosterResolver.RosterEvidence evA = a.evidence() != null ? a.evidence() : TeamRosterResolver.RosterEvidence.empty();
        final TeamRosterResolver.RosterEvidence evB = b.evidence() != null ? b.evidence() : TeamRosterResolver.RosterEvidence.empty();
        if (!evA.sufficientCoverage() || !evB.sufficientCoverage()) {
            return false;
        }
        if (Objects.equals(a.ctx().battleId(), b.ctx().battleId())
                && a.ctx().perspectiveTeam() != b.ctx().perspectiveTeam()) {
            return false;
        }
        final String clanA = TeamRosterResolver.normalizedDominantClan(
                a.ctx().battle(), a.ctx().perspectiveTeam());
        final String clanB = TeamRosterResolver.normalizedDominantClan(
                b.ctx().battle(), b.ctx().perspectiveTeam());
        final boolean aHasClan = StringUtils.hasText(clanA);
        final boolean bHasClan = StringUtils.hasText(clanB);
        if (aHasClan != bHasClan) {
            return false;
        }
        if (aHasClan) {
            if (!clanA.equals(clanB)) {
                return false;
            }
            return TeamRosterResolver.jaccard(evA.distinctValidAccountIds(), evB.distinctValidAccountIds())
                    >= TeamRosterResolver.MIN_ROSTER_JACCARD;
        }
        return TeamRosterResolver.jaccard(evA.distinctValidAccountIds(), evB.distinctValidAccountIds())
                >= TeamRosterResolver.MIN_ROSTER_JACCARD;
    }

}
