package com.wotb.core.replay.processing;

import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
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
        Objects.requireNonNull(results, "results");
        return analyzePartition(ExactReplayDuplicateDetector.partition(results));
    }

    /** 直接使用已计算的 partition（{@link #analyze} 的内部实现；同包测试可复用）。 */
    AnalysisPlan analyzePartition(
            final ExactReplayDuplicateDetector.ExactDuplicatePartition partition
    ) {
        Objects.requireNonNull(partition, "partition");

        // 1. 确定每个文件的 category + scope（仅 unique 结果参与）
        final List<ScopedResult> scoped = partition.uniqueResults().stream()
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

        // 3. (dedup done in step 0 via ExactReplayDuplicateDetector)

        // 4. 按 BattleGroupingKey + perspectiveTeam 分组（跳过 FAILED 和 UNKNOWN scope）
        final Map<ReplayPerspectiveGroupKey, List<ScopedResult>> groups = new LinkedHashMap<>();
        for (final ScopedResult sr : scoped) {
            if (sr.result().status() == ReplayProcessingStatus.FAILED) continue;
            if (sr.scope() == null) continue;
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
            final var battleId = entry.getKey().battleKey().toBattleIdentity();
            perspectiveGroups.add(new ReplayPerspectiveGroup(
                    entry.getKey(), battleId, representative.result(), teamDuplicates));
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
                        && isAiAnalyzable(g.representative(), dominantScope))
                .count();

        final ReplayAnalysisMode mode = resolveMode(dominantScope, analyzableCount);
        final var exactDuplicates = partition.duplicates();

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
        return new ReplayPerspectiveGroupKey(key, resolvePerspectiveTeam(r));
    }

    private static int resolvePerspectiveTeam(final ReplayProcessingResult r) {
        final TeamPerspectiveResolution resolution =
                TeamPerspectiveResolver.resolve(r.battle(), r.reconstruction());
        return resolution.resolved() ? resolution.perspectiveTeam() : 0;
    }

    /**
     * 选择代表回放：按质量降序排列：reconstruction → streamComplete → decodedRatio → failedPackets → unknownPackets → resyncCount。
     */
    static ScopedResult selectRepresentative(final List<ScopedResult> group) {
        if (group.size() == 1) return group.getFirst();
        return group.stream().min(representativeComparator()).orElse(group.getFirst());
    }

    private static java.util.Comparator<ScopedResult> representativeComparator() {
        return java.util.Comparator
                .<ScopedResult>comparingInt(s -> hasReconstruction(s) ? 0 : 1)
                .thenComparing((s -> isStreamComplete(s) ? 0 : 1))
                .thenComparing(
                        java.util.Comparator.comparingDouble(
                                BatchAnalyzer::decodedRatio).reversed())
                .thenComparingInt(BatchAnalyzer::failedPackets)
                .thenComparingInt(BatchAnalyzer::unknownPackets)
                .thenComparingInt(BatchAnalyzer::resyncCount);
    }

    private static boolean hasReconstruction(final ScopedResult s) {
        final var caps = s.result().capabilities();
        return caps != null && caps.reconstructionAvailable();
    }

    private static boolean isStreamComplete(final ScopedResult s) {
        final var diag = s.result().diagnostics();
        return diag != null && diag.diagnostics() != null && diag.diagnostics().streamComplete();
    }

    private static ReplayCoverage coverage(final ScopedResult s) {
        return s.result().reconstruction() != null ? s.result().reconstruction().coverage() : null;
    }

    private static double decodedRatio(final ScopedResult s) {
        final var cov = coverage(s);
        return cov != null ? cov.decodedPacketRatio() : 0.0;
    }

    private static int failedPackets(final ScopedResult s) {
        final var cov = coverage(s);
        return cov != null ? cov.failedPackets() : Integer.MAX_VALUE;
    }

    private static int unknownPackets(final ScopedResult s) {
        final var cov = coverage(s);
        return cov != null ? cov.unknownPackets() : Integer.MAX_VALUE;
    }

    private static int resyncCount(final ScopedResult s) {
        final var diag = s.result().diagnostics();
        if (diag == null || diag.diagnostics() == null) return Integer.MAX_VALUE;
        return diag.diagnostics().resyncCount();
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

    /** 基于 scope 的实际可分析判定（不在 Facade 中预计算）。 */
    public static boolean isAiAnalyzable(final ReplayProcessingCapabilities caps, final ReplayAnalysisScope scope) {
        if (caps == null || scope == null) return false;
        return switch (scope) {
            case PLAYER_FOCUSED -> caps.summaryAvailable() && caps.recorderResultAvailable();
            case TEAM_PERSPECTIVE -> caps.summaryAvailable()
                    && caps.perspectiveTeamResolved()
                    && (caps.recorderResultAvailable()
                            || caps.teamFeatureExtractionPossible());
        };
    }

    /** 从 ReplayProcessingResult 提取 capabilities。 */
    public static boolean isAiAnalyzable(final ReplayProcessingResult result, final ReplayAnalysisScope scope) {
        return isAiAnalyzable(result != null ? result.capabilities() : null, scope);
    }

    /** 简化重载：从 ScopedResult 取 scope。 */
    public static boolean isAiAnalyzable(final ReplayProcessingResult result, final ScopedResult scoped) {
        return isAiAnalyzable(result, scoped != null ? scoped.scope() : null);
    }

    /**
     * 单文件 AI 复盘下有效可分析单元数最多为 1，因此只会返回 NONE 或 SINGLE_*。
     * 入参仍是列表（通用分组），防御性保留：多于 1 个可分析单元时按所属 scope 返回
     * SINGLE_*（MULTI_* 已随 legacy 批量端点删除，不再产生）。
     */
    private static ReplayAnalysisMode resolveMode(final ReplayAnalysisScope scope, final int analyzableCount) {
        if (analyzableCount <= 0) return ReplayAnalysisMode.NONE;
        if (scope == ReplayAnalysisScope.PLAYER_FOCUSED) return ReplayAnalysisMode.SINGLE_PLAYER_BATTLE;
        if (scope == ReplayAnalysisScope.TEAM_PERSPECTIVE) return ReplayAnalysisMode.SINGLE_TEAM_BATTLE;
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
     * 分析计划。
     */
    public record AnalysisPlan(
            ReplayAnalysisMode mode,
            ReplayAnalysisScope dominantScope,
            List<ReplayPerspectiveGroup> groups,
            int effectiveUnitCount,
            List<ExactReplayDuplicate> exactDuplicates,
            int exactDuplicateCount,
            int sameTeamDuplicatePerspectiveCount,
            int analyzableUnitCount
    ) {
    }
}
