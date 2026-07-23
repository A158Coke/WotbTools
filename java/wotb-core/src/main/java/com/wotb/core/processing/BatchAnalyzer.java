package com.wotb.core.processing;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.BattleParticipant;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 批量回放分析器：分组、去重、代表选择、模式判定。
 * <p>
 * 处理流程：
 * <ol>
 *   <li>按 BattleCategory 确定 AnalysisScope</li>
 *   <li>验证 scope 一致性（不混合随机战斗和训练房）</li>
 *   <li>精确重复去重（SHA-256）</li>
 *   <li>按 BattleIdentity + perspectiveTeam 视角分组</li>
 *   <li>选择代表回放</li>
 *   <li>验证录像者一致性（随机战斗时）</li>
 *   <li>计算有效分析单元数，判定 ReplayAnalysisMode</li>
 * </ol>
 * </p>
 */
public class BatchAnalyzer {

    /**
     * 分析一批回放结果，返回分组后的分析计划。
     *
     * @param results 逐文件处理结果（保留顺序）
     * @return 分析计划
     */
    public AnalysisPlan analyze(final List<ReplayProcessingResult> results) {
        // 1. 确定每个文件的 category + scope
        final List<ScopedResult> scoped = results.stream()
                .map(this::toScopedResult)
                .toList();

        // 2. 检查 scope 一致性
        final Set<ReplayAnalysisScope> scopes = scoped.stream()
                .map(ScopedResult::scope)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (scopes.size() > 1) {
            throw new MixedAnalysisScopesException(
                    "Mixed analysis scopes: " + scopes);
        }

        // 3. 过滤失败结果，按 BattleIdentity + perspectiveTeam 分组
        final Map<ReplayPerspectiveGroupKey, List<ScopedResult>> groups = new HashMap<>();
        for (final ScopedResult sr : scoped) {
            if (sr.result().status() == ReplayProcessingStatus.FAILED) continue;
            final ReplayPerspectiveGroupKey key = resolveKey(sr);
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(sr);
        }

        // 4. 选择代表回放，计算关系
        final List<ReplayPerspectiveGroup> perspectiveGroups = new ArrayList<>();
        for (final var entry : groups.entrySet()) {
            final List<ScopedResult> groupResults = entry.getValue();
            final ScopedResult representative = selectRepresentative(groupResults);

            final List<ReplayProcessingResult> duplicates = new ArrayList<>();
            for (final ScopedResult sr : groupResults) {
                if (sr.result() != representative.result()) {
                    duplicates.add(sr.result());
                }
            }
            perspectiveGroups.add(new ReplayPerspectiveGroup(
                    entry.getKey(), representative.result(), duplicates));
        }

        // 5. 验证录像者一致性（仅 PLAYER_FOCUSED）
        if (scopes.contains(ReplayAnalysisScope.PLAYER_FOCUSED)) {
            final List<ScopedResult> playerResults = scoped.stream()
                    .filter(s -> s.scope() == ReplayAnalysisScope.PLAYER_FOCUSED)
                    .filter(s -> s.category() == BattleCategory.RANDOM)
                    .toList();

            final Set<Long> recorderAccounts = new HashSet<>();
            for (final ScopedResult sr : playerResults) {
                final Long accId = extractRecorderAccountId(sr.result());
                if (accId != null) recorderAccounts.add(accId);
            }
            if (recorderAccounts.size() > 1) {
                throw new MixedRandomBattleRecordersException(
                        "Mixed recorders: " + recorderAccounts);
            }
        }

        // 6. 判定模式
        final ReplayAnalysisScope dominantScope = scopes.isEmpty() ? null : scopes.iterator().next();
        final int effectiveUnits = perspectiveGroups.size();
        final int analyzableCount = (int) perspectiveGroups.stream()
                .filter(g -> g.representative().capabilities() != null
                        && g.representative().capabilities().aiAnalyzable())
                .count();

        final ReplayAnalysisMode mode = resolveMode(dominantScope, analyzableCount);

        return new AnalysisPlan(mode, dominantScope, perspectiveGroups, effectiveUnits);
    }

    private ScopedResult toScopedResult(final ReplayProcessingResult result) {
        if (result.status() == ReplayProcessingStatus.FAILED) {
            return new ScopedResult(result, BattleCategory.UNKNOWN, null);
        }
        final BattleCategory category = detectCategory(result);
        final ReplayAnalysisScope scope;
        try {
            scope = BattleCategoryUtils.resolveScope(category);
        } catch (UnsupportedBattleCategoryException e) {
            return new ScopedResult(result, category, null);
        }
        return new ScopedResult(result, category, scope);
    }

    private BattleCategory detectCategory(final ReplayProcessingResult result) {
        if (result.battle() != null && result.battle().arenaBonusType != null) {
            return BattleCategoryUtils.fromArenaBonusType(result.battle().arenaBonusType);
        }
        return BattleCategory.UNKNOWN;
    }

    private static ReplayPerspectiveGroupKey resolveKey(final ScopedResult sr) {
        final ReplayProcessingResult r = sr.result();
        final String arenaUniqueId = r.battle() != null ? r.battle().arenaId : "";
        final String mapCode = r.battle() != null ? r.battle().mapName : "";
        final BattleCategory category = sr.category();

        final BattleIdentity identity = new BattleIdentity(
                arenaUniqueId, mapCode, "", null);

        // 对于 PLAYER_FOCUSED，perspectiveTeam 取录像者所在队伍
        int perspectiveTeam = 0;
        if (r.battle() != null && r.battle().recorder != null) {
            final String recorderNick = r.battle().recorder;
            for (final BattleParticipant p : (r.reconstruction() != null
                    ? r.reconstruction().participants() : List.<BattleParticipant>of())) {
                if (p.nickname().equals(recorderNick)) {
                    perspectiveTeam = p.team();
                    break;
                }
            }
            // 从 Battle player 列表降级
            if (perspectiveTeam == 0 && r.battle().players != null) {
                for (final var pr : r.battle().players) {
                    if (recorderNick.equals(pr.nickname)) {
                        perspectiveTeam = pr.team;
                        break;
                    }
                }
            }
        }

        return new ReplayPerspectiveGroupKey(identity, perspectiveTeam);
    }

    /**
     * 选择代表回放：优先 streamComplete → reconstruction → coverage → resync少 → 上传顺序前。
     */
    static ScopedResult selectRepresentative(final List<ScopedResult> group) {
        if (group.size() == 1) return group.getFirst();

        return group.stream().min((a, b) -> {
            final var capA = a.result().capabilities();
            final var capB = b.result().capabilities();
            final int reconA = capA != null && capA.reconstructionAvailable() ? 1 : 0;
            final int reconB = capB != null && capB.reconstructionAvailable() ? 1 : 0;
            return reconB - reconA;
        }).orElse(group.getFirst());
    }

    private Long extractRecorderAccountId(final ReplayProcessingResult result) {
        if (result.reconstruction() == null) return null;
        for (final BattleParticipant p : result.reconstruction().participants()) {
            if (p.recorder()) return p.accountId();
        }
        if (result.battle() != null && result.battle().recorder != null) {
            final String nick = result.battle().recorder;
            for (final BattleParticipant p : result.reconstruction().participants()) {
                if (nick.equals(p.nickname())) return p.accountId();
            }
        }
        return null;
    }

    private static ReplayAnalysisMode resolveMode(final ReplayAnalysisScope scope, final int analyzableCount) {
        if (analyzableCount <= 0) return ReplayAnalysisMode.NONE;
        if (scope == ReplayAnalysisScope.PLAYER_FOCUSED) {
            return analyzableCount == 1
                    ? ReplayAnalysisMode.SINGLE_PLAYER_BATTLE
                    : ReplayAnalysisMode.MULTI_PLAYER_BATTLE;
        }
        if (scope == ReplayAnalysisScope.TEAM_PERSPECTIVE) {
            return analyzableCount == 1
                    ? ReplayAnalysisMode.SINGLE_TEAM_BATTLE
                    : ReplayAnalysisMode.MULTI_TEAM_BATTLE;
        }
        return ReplayAnalysisMode.NONE;
    }

    // ---- 内部类型 ----

    /** 处理结果 + 推导的 category + scope。 */
    public record ScopedResult(
            ReplayProcessingResult result,
            BattleCategory category,
            ReplayAnalysisScope scope
    ) {}

    /** 分析计划。 */
    public record AnalysisPlan(
            ReplayAnalysisMode mode,
            ReplayAnalysisScope dominantScope,
            List<ReplayPerspectiveGroup> groups,
            int effectiveUnitCount
    ) {}
}
