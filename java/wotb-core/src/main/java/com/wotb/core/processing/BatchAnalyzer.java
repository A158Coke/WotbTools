package com.wotb.core.processing;

import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
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
     * <p>
     * 处理流程：
     * <ol>
     *   <li>按 BattleCategory 确定 AnalysisScope</li>
     *   <li>验证 scope 一致性（不混合随机战斗和训练房，以及 UNKNOWN）</li>
     *   <li>精确重复去重（SHA-256）</li>
     *   <li>按 BattleIdentity + perspectiveTeam 视角分组</li>
     *   <li>选择代表回放</li>
     *   <li>验证录像者一致性（随机战斗时）</li>
     *   <li>计算有效分析单元数，判定 ReplayAnalysisMode</li>
     * </ol>
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
        // 2b. UNKNOWN category 不得与已知 scope 混合
        final boolean hasUnknownNonFailed = scoped.stream()
                .anyMatch(s -> s.scope() == null
                        && s.result().status() != ReplayProcessingStatus.FAILED);
        if (hasUnknownNonFailed && scopes.size() == 1) {
            throw new MixedAnalysisScopesException(
                    "Cannot mix UNKNOWN battle category with "
                            + scopes.iterator().next());
        }

        // 3. SHA-256 精确重复去重（跳过 FAILED 结果）
        final Map<String, List<ScopedResult>> byHash = new LinkedHashMap<>();
        for (final ScopedResult sr : scoped) {
            if (sr.result().status() == ReplayProcessingStatus.FAILED) continue;
            final String hash = sr.result().identity() != null
                    ? sr.result().identity().contentHash() : null;
            final String key = hash != null ? hash
                    : "__no_hash_" + sr.result().fileName();
            byHash.computeIfAbsent(key, k -> new ArrayList<>()).add(sr);
        }

        final List<ScopedResult> uniqueResults = new ArrayList<>();
        final List<ExactDuplicate> exactDuplicates = new ArrayList<>();
        for (final var entry : byHash.entrySet()) {
            final List<ScopedResult> hashGroup = entry.getValue();
            final ReplayProcessingResult original = hashGroup.getFirst().result();
            uniqueResults.add(hashGroup.getFirst());
            for (int i = 1; i < hashGroup.size(); i++) {
                exactDuplicates.add(new ExactDuplicate(
                        original, hashGroup.get(i).result()));
            }
        }

        // 4. 按 BattleIdentity + perspectiveTeam 分组（跳过 FAILED 和 UNKNOWN scope）
        final Map<ReplayPerspectiveGroupKey, List<ScopedResult>> groups = new HashMap<>();
        for (final ScopedResult sr : uniqueResults) {
            if (sr.result().status() == ReplayProcessingStatus.FAILED) continue;
            if (sr.scope() == null) continue; // UNKNOWN 不参与分析分组
            final ReplayPerspectiveGroupKey key = resolveKey(sr);
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(sr);
        }

        // 5. 选择代表回放，计算同队重复视角
        final List<ReplayPerspectiveGroup> perspectiveGroups = new ArrayList<>();
        int sameTeamDupCount = 0;
        for (final var entry : groups.entrySet()) {
            final List<ScopedResult> groupResults = entry.getValue();
            final ScopedResult representative = selectRepresentative(groupResults);

            final List<ReplayProcessingResult> teamDuplicates = new ArrayList<>();
            for (final ScopedResult sr : groupResults) {
                if (sr.result() != representative.result()) {
                    teamDuplicates.add(sr.result());
                    sameTeamDupCount++;
                }
            }
            perspectiveGroups.add(new ReplayPerspectiveGroup(
                    entry.getKey(), representative.result(), teamDuplicates));
        }

        // 6. 验证录像者一致性（仅 PLAYER_FOCUSED + RANDOM）
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

        // 7. 判定模式
        final ReplayAnalysisScope dominantScope = scopes.isEmpty() ? null : scopes.iterator().next();
        final int effectiveUnits = perspectiveGroups.size();
        final int analyzableCount = (int) perspectiveGroups.stream()
                .filter(g -> g.representative().capabilities() != null
                        && g.representative().capabilities().aiAnalyzable())
                .count();

        final ReplayAnalysisMode mode = resolveMode(dominantScope, analyzableCount);

        return new AnalysisPlan(mode, dominantScope, perspectiveGroups, effectiveUnits,
                exactDuplicates, exactDuplicates.size(), sameTeamDupCount, analyzableCount);
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
        final var key = BattleGroupingKey.from(r.identity(), r.battle(), r.fileName());
        return new ReplayPerspectiveGroupKey(key, key.toBattleIdentity(), resolvePerspectiveTeam(r));
    }

    private static int resolvePerspectiveTeam(final ReplayProcessingResult r) {
        int team = 0;
        if (r.battle() != null && r.battle().recorder != null) {
            final String nick = r.battle().recorder;
            for (final BattleParticipant p : (r.reconstruction() != null
                    ? r.reconstruction().participants() : List.<BattleParticipant>of())) {
                if (nick.equals(p.nickname())) { team = p.team(); break; }
            }
            if (team == 0 && r.battle().players != null) {
                for (final var pr : r.battle().players) {
                    if (nick.equals(pr.nickname)) { team = pr.team; break; }
                }
            }
        }
        return team;
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

    private static Long extractRecorderAccountId(final ReplayProcessingResult result) {
        final Long authoritative = PlayerResultFormat.recorderAccountId(result.battle());
        if (authoritative != null) return authoritative;
        // 降级：从 reconstruction participants 查找
        if (result.reconstruction() != null) {
            for (final BattleParticipant p : result.reconstruction().participants()) {
                if (p.recorder() && p.accountId() > 0) return p.accountId();
            }
            if (result.battle() != null && result.battle().recorder != null) {
                final String nick = result.battle().recorder;
                for (final BattleParticipant p : result.reconstruction().participants()) {
                    if (nick.equals(p.nickname()) && p.accountId() > 0) return p.accountId();
                }
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

    /**
     * 处理结果 + 推导的 category + scope。
     */
    public record ScopedResult(
            ReplayProcessingResult result,
            BattleCategory category,
            ReplayAnalysisScope scope
    ) {
    }

    /**
     * 精确重复关系：original 是保留的原始文件，duplicate 是被去重的副本。
     */
    public record ExactDuplicate(
            ReplayProcessingResult original,
            ReplayProcessingResult duplicate
    ) {
    }

    /**
     * 分析计划。
     */
    public record AnalysisPlan(
            ReplayAnalysisMode mode,
            ReplayAnalysisScope dominantScope,
            List<ReplayPerspectiveGroup> groups,
            int effectiveUnitCount,
            List<ExactDuplicate> exactDuplicates,
            int exactDuplicateCount,
            int sameTeamDuplicatePerspectiveCount,
            int analyzableUnitCount
    ) {
    }
}
