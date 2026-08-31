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
 * 当前 AI request 的 result-set 分析器：分组、去重、代表选择、模式判定。
 * <p>它保留现有多-source request 的确定性收尾契约；不表示 future worker queue、job
 * status 或 batch manager，也不增加异步基础设施。</p>
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
        for (final var entry : groups.entrySet()) {
            final List<ScopedResult> groupResults = entry.getValue();
            final ScopedResult representative = selectRepresentative(groupResults);

            final List<ReplayProcessingResult> teamDuplicates = new ArrayList<>();
            for (final ScopedResult sr : groupResults) {
                if (sr.result() != representative.result()) {
                    teamDuplicates.add(sr.result());
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

        // 7. 判定模式（AI 单文件 single-analyzable-unit invariant；多单元 fail loud）
        final ReplayAnalysisScope dominantScope = scopes.isEmpty() ? null : scopes.iterator().next();
        final int analyzableCount = (int) perspectiveGroups.stream()
                .filter(g -> g.representative().capabilities() != null
                        && g.representative().capabilities().aiAnalyzable(dominantScope))
                .count();

        final ReplayAnalysisMode mode = resolveMode(dominantScope, analyzableCount);
        return new AnalysisPlan(mode, dominantScope, perspectiveGroups);
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
     * 选择代表回放：按质量降序排列：reconstruction → decodedRatio → failedPackets → unknownPackets。
     */
    static ScopedResult selectRepresentative(final List<ScopedResult> group) {
        if (group.size() == 1) return group.getFirst();
        return group.stream().min(representativeComparator()).orElse(group.getFirst());
    }

    private static java.util.Comparator<ScopedResult> representativeComparator() {
        return java.util.Comparator
                .<ScopedResult>comparingInt(s -> hasReconstruction(s) ? 0 : 1)
                .thenComparing(
                        java.util.Comparator.comparingDouble(
                                BatchAnalyzer::decodedRatio).reversed())
                .thenComparingInt(BatchAnalyzer::failedPackets)
                .thenComparingInt(BatchAnalyzer::unknownPackets);
    }

    private static boolean hasReconstruction(final ScopedResult s) {
        final var caps = s.result().capabilities();
        return caps != null && caps.reconstructionAvailable();
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

    /**
     * AI 复盘为单文件 / 单可分析单元，因此只有 0（不可分析 → NONE）或 1（SINGLE_*）两种
     * 合法结果。超过 1 个可分析单元意味着传入了多结果批量（旧 multipart multi 架构），
     * 在此 fail loud，绝不静默将其伪装成 SINGLE。
     */
    private static ReplayAnalysisMode resolveMode(final ReplayAnalysisScope scope, final int analyzableCount) {
        if (analyzableCount == 0) return ReplayAnalysisMode.NONE;
        if (analyzableCount > 1) {
            throw new IllegalStateException(
                    "AI review is single-source / single-analyzable-unit only; "
                            + "got analyzableUnitCount=" + analyzableCount + ", scope=" + scope);
        }
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
     *
     * @param mode          判定出的 AI 分析模式（NONE / SINGLE_*；AI 单文件场景下绝不出现 MULTI）
     * @param dominantScope 主导分析 scope（可为 null）
     * @param groups        视角分组（AI 分析单元；单文件场景下 ≤ 1）
     */
    public record AnalysisPlan(
            ReplayAnalysisMode mode,
            ReplayAnalysisScope dominantScope,
            List<ReplayPerspectiveGroup> groups
    ) {
    }
}