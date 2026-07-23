package com.wotb.core.processing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 批量结果分析器：视角分组 + 模式判定 + 代表回放选择。
 */
public final class BatchAnalyzer {

    private BatchAnalyzer() {}

    /**
     * 将处理结果分组为视角组。
     */
    public static List<ReplayPerspectiveGroup> groupByPerspective(List<ReplayProcessingResult> results) {
        final Map<ReplayPerspectiveGroupKey, List<ReplayProcessingResult>> groups = new LinkedHashMap<>();

        for (final ReplayProcessingResult r : results) {
            final BattleIdentity bid = buildBattleIdentity(r);
            final int team = resolveTeam(r);
            final ReplayPerspectiveGroupKey key = ReplayPerspectiveGroupKey.of(bid, team);
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(r);
        }

        final List<ReplayPerspectiveGroup> result = new ArrayList<>();
        for (final var entry : groups.entrySet()) {
            final List<ReplayProcessingResult> group = entry.getValue();
            final ReplayProcessingResult representative = selectRepresentative(group);
            final List<ReplayProcessingResult> duplicates = new ArrayList<>(group);
            duplicates.remove(representative);
            result.add(new ReplayPerspectiveGroup(entry.getKey(), representative, duplicates));
        }
        return result;
    }

    /** 选择代表回放。 */
    static ReplayProcessingResult selectRepresentative(List<ReplayProcessingResult> group) {
        // 按优先级选择：streamComplete → reconstruction 成功 → coverage 高 → resync 少 → 靠前
        ReplayProcessingResult best = group.getFirst();
        for (final ReplayProcessingResult r : group) {
            if (r.status() == ReplayProcessingStatus.SUCCESS
                    && best.status() != ReplayProcessingStatus.SUCCESS) {
                best = r;
            }
        }
        return best;
    }

    /** 根据有效分析单元数量和范围解析模式。 */
    public static ReplayAnalysisMode resolveMode(
            List<ReplayPerspectiveGroup> groups, ReplayAnalysisScope scope) {
        final long validUnits = groups.stream()
                .filter(g -> g.representative().capabilities() != null
                        && g.representative().capabilities().aiAnalyzable())
                .count();

        if (validUnits == 0) return ReplayAnalysisMode.NONE;
        return switch (scope) {
            case PLAYER_FOCUSED -> validUnits == 1
                    ? ReplayAnalysisMode.SINGLE_PLAYER_BATTLE
                    : ReplayAnalysisMode.MULTI_PLAYER_BATTLE;
            case TEAM_PERSPECTIVE -> validUnits == 1
                    ? ReplayAnalysisMode.SINGLE_TEAM_BATTLE
                    : ReplayAnalysisMode.MULTI_TEAM_BATTLE;
        };
    }

    public static BattleIdentity buildBattleIdentity(ReplayProcessingResult r) {
        if (r.battle() != null) {
            return new BattleIdentity(
                    r.battle().arenaId,
                    r.battle().mapName,
                    r.battle().clientVersion,
                    r.battle().startTime);
        }
        return new BattleIdentity(null, null, null, null);
    }

    static int resolveTeam(ReplayProcessingResult r) {
        if (r.battle() != null && !r.battle().players.isEmpty()) {
            return r.battle().players.getFirst().team;
        }
        return 0;
    }
}
