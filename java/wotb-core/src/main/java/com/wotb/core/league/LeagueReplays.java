package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.Replays;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * League Rating 模式的批次收集：解析全部输入 → 模式判定 → 去重/冲突 → 完整性校验 → 评分。
 *
 * <p><b>Replay Core validity and League Rating eligibility are independent domains</b>：
 * {@link LeagueCollectResult#battles()} 返回<b>全部</b>成功解析并通过去重/冲突规则的 Battle
 * （可进入 Preview/Export 的基础数据）；League Rating <b>只</b>对通过
 * {@link LeagueRatingValidator} 完整性校验的场次计算（{@link LeagueRatingBatch#battleResults()}
 * 与汇总均只含 eligible 场次）。Rating-ineligible parsed battles remain valid Replay results——
 * Rating 校验失败<b>不得</b>把 Battle 从结果中移除，失败以 {@link LeagueFailure} 稳定错误码返回。</p>
 *
 * <p>普通模式（{@code STANDARD_REPLAY}）复用 {@link Replays} 既有 arenaId 去重语义，
 * 普通回放契约零回归；混合模式（{@code MIXED_UNSUPPORTED}）同普通模式返回全部可解析
 * battles（League Rating 不支持混合批次聚合，League Analysis unavailable 由调用方提示，
 * 禁止 mixed League eligibility 污染 Replay Parser。</p>
 *
 * <p>league 去重范围仅限当前上传批次：同一 arenaId 多份回放关键事实一致 →
 * 只计一份、其余进 duplicates；不一致 → 该场全部副本拒绝评分（{@code CONFLICTING_REPLAYS_FOR_ARENA}）。
 * 不自动选择「字段更多」的副本；不建立持久化记录。死亡 provenance 与 live observation
 * 不参与 League duplicate identity，也不会通过副本收口回写任何 Battle。</p>
 */
public final class LeagueReplays {

    /**
     * 批次收集结果：mode + 成功解析的 battles（可进 Preview）+ 重复/解析失败 +
     * league 校验失败 + league 评分与汇总（battleResults 仅含 eligible 场次）。
     * battles/battleSourceNames 与 leagueBatch.battleResults() 不再要求数量一一对应；
     * Battle 与 Rating 的关联使用 {@link LeagueRatingResult#arenaId()} identity。
     */
    public record LeagueCollectResult(
            LeagueRatingMode mode,
            List<Battle> battles,
            List<String> battleSourceNames,
            List<String> battleSourceIds,
            List<String[]> duplicates,
            List<String[]> failures,
            List<LeagueFailure> leagueFailures,
            LeagueRatingBatch leagueBatch) {

        public LeagueCollectResult {
            battles = battles == null ? List.of() : List.copyOf(battles);
            battleSourceNames = battleSourceNames == null ? List.of() : List.copyOf(battleSourceNames);
            battleSourceIds = battleSourceIds == null ? List.of() : List.copyOf(battleSourceIds);
            duplicates = duplicates == null ? List.of() : List.copyOf(duplicates);
            failures = failures == null ? List.of() : List.copyOf(failures);
            leagueFailures = leagueFailures == null ? List.of() : List.copyOf(leagueFailures);
        }
    }

    private LeagueReplays() {
    }

    /**
     * 模式感知收集（与 {@link Replays#collect} 相同 loader/progress 契约；
     * 每个输入文件恰好回调一次 progress，类别=解析/重复/校验失败/成功）。
     */
    public static LeagueCollectResult collect(final List<Source> sources,
                                              final Replays.BattleLoader loader,
                                              final Consumer<String> log,
                                              final Replays.ReplayProgressListener progress) {
        return finalize(Replays.parseAll(sources, loader, log), log, progress);
    }

    /**
     * 已解析条目（{@link Replays.ParsedEntry}）的批次收尾：模式判定 → 去重/冲突 →
     * 完整性校验 → 评分 → 汇总。
     *
     * <p>与 {@link #collect} 的语义完全一致（同一 authoritative 链路），但<b>不再负责
     * 逐文件解析</b>——调用方（如 Replay Processing Pipeline）可先并发完成全部分析，
     * 再在本方法内单线程 deterministic 收尾；解析完成顺序不影响结果。</p>
     */
    public static LeagueCollectResult finalize(final List<Replays.ParsedEntry> entries,
                                               final Consumer<String> log,
                                               final Replays.ReplayProgressListener progress) {
        final LeagueRatingMode mode = LeagueRatingMode.classify(entries.stream()
                .filter(e -> !e.failed())
                .map(Replays.ParsedEntry::battle).toList());
        if (mode == LeagueRatingMode.MIXED_UNSUPPORTED) {
            // 混合批次（普通 + 训练赛/联赛混传）：League Rating 不支持混合批次聚合，
            // 但<b>不得污染 Replay Parser</b>——所有可解析回放仍按
            // 普通回放语义成功返回（标准 arenaId 去重，progress 真实 outcome），League
            // Analysis unavailable 由调用方以 leagueUnavailableCode 提示，不再整体拒绝。
            final com.wotb.core.model.Collected c = Replays.dedupe(entries, log, progress);
            return new LeagueCollectResult(mode, c.battles, c.battleSourceNames, c.battleSourceIds, c.duplicates,
                    c.failures, List.of(), null);
        }
        if (mode == LeagueRatingMode.STANDARD_REPLAY) {
            final com.wotb.core.model.Collected c = Replays.dedupe(entries, log, progress);
            return new LeagueCollectResult(mode, c.battles, c.battleSourceNames, c.battleSourceIds, c.duplicates,
                    c.failures, List.of(), null);
        }
        return collectLeague(entries, progress);
    }

    /**
     * league 分支：去重/冲突 → 校验 → 评分 → 汇总。
     *
     * <p>返回的 battles = 去重/冲突后<b>全部</b>成功解析的 Battle（Rating 不合格也保留，
     * 只进 leagueFailures）；ratedBattles/ratedNames/results 仅用于 League Rating 计算与
     * 批次聚合（aggregate 只基于 eligible 场次）。</p>
     */
    private static LeagueCollectResult collectLeague(final List<Replays.ParsedEntry> entries,
                                                     final Replays.ReplayProgressListener progress) {
        // 按 arenaId 分组（保留上传顺序）
        final Map<String, List<Replays.ParsedEntry>> byArena = new LinkedHashMap<>();
        for (final Replays.ParsedEntry e : entries) {
            if (e.failed()) {
                continue;
            }
            byArena.computeIfAbsent(e.battle().arenaId, k -> new ArrayList<>()).add(e);
        }

        final List<Battle> battles = new ArrayList<>();
        final List<String> battleSourceNames = new ArrayList<>();
        final List<String> battleSourceIds = new ArrayList<>();
        final List<String[]> duplicates = new ArrayList<>();
        final List<LeagueFailure> leagueFailures = new ArrayList<>();
        final List<String> conflictedArenas = new ArrayList<>();

        for (final Map.Entry<String, List<Replays.ParsedEntry>> group : byArena.entrySet()) {
            final List<Replays.ParsedEntry> copies = group.getValue();
            // group-level all-pairs settlement identity check; live observation/provenance is excluded.
            final boolean conflicted = copies.size() > 1
                    && !LeagueRatingConflictDetector.validateCopies(
                            copies.stream().map(Replays.ParsedEntry::battle).toList());
            if (conflicted) {
                conflictedArenas.add(group.getKey());
                for (final Replays.ParsedEntry copy : copies) {
                    leagueFailures.add(new LeagueFailure(copy.sourceName(), group.getKey(),
                            LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA));
                }
                continue;
            }
            // 一致：只保留第一份（source identity），其余进 duplicates。
            final Replays.ParsedEntry kept = copies.getFirst();
            for (int i = 1; i < copies.size(); i++) {
                duplicates.add(new String[]{copies.get(i).sourceName(), group.getKey()});
            }
            battles.add(kept.battle());
            battleSourceNames.add(kept.sourceName());
            battleSourceIds.add("r" + kept.sourceIndex());
        }

        // 校验 + 评分（每场独立；不合格该场不评分但 Battle 仍保留在 battles，
        // 只记录 leagueFailure；eligible 场次进入 ratedBattles 用于 Rating 与批次聚合）
        final List<LeagueRatingResult> results = new ArrayList<>();
        final List<Battle> ratedBattles = new ArrayList<>();
        final List<String> ratedNames = new ArrayList<>();
        for (int i = 0; i < battles.size(); i++) {
            final Battle battle = battles.get(i);
            final String name = battleSourceNames.get(i);
            final List<LeagueFailure> validation = LeagueRatingValidator.validate(battle);
            if (!validation.isEmpty()) {
                leagueFailures.add(validation.getFirst().withFileName(name));
                continue;
            }
            ratedBattles.add(battle);
            ratedNames.add(name);
            results.add(LeagueRatingCalculator.calculate(battle));
        }

        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                ratedBattles, results, leagueFailures);

        // progress：解析失败 → FAILURE；冲突副本 → FAILURE；重复 → DUPLICATE；
        // Rating 校验失败（非冲突）→ SUCCESS（已成功解析并可进 Preview；Rating 不合格
        // 是独立领域信息，经 leagueFailures 返回，不得计入解析失败）；其余 → SUCCESS
        // （每个文件恰好一次）
        if (progress != null) {
            final Map<String, Replays.Outcome> outcomeBySource = new LinkedHashMap<>();
            for (final Replays.ParsedEntry e : entries) {
                if (e.failed()) {
                    outcomeBySource.put(e.sourceName(), Replays.Outcome.FAILURE);
                    continue;
                }
                if (conflictedArenas.contains(e.battle().arenaId)) {
                    outcomeBySource.put(e.sourceName(), Replays.Outcome.FAILURE);
                    continue;
                }
                if (duplicates.stream().anyMatch(d -> d[0].equals(e.sourceName()))) {
                    outcomeBySource.put(e.sourceName(), Replays.Outcome.DUPLICATE);
                    continue;
                }
                outcomeBySource.put(e.sourceName(), Replays.Outcome.SUCCESS);
            }
            for (final Replays.ParsedEntry e : entries) {
                progress.onProcessed(e.sourceIndex(), e.sourceName(), outcomeBySource.get(e.sourceName()));
            }
        }

        return new LeagueCollectResult(LeagueRatingMode.LEAGUE_RATING,
                battles, battleSourceNames, battleSourceIds, duplicates,
                failuresFrom(entries), leagueFailures, batch);
    }

    private static List<String[]> failuresFrom(final List<Replays.ParsedEntry> entries) {
        final List<String[]> out = new ArrayList<>();
        for (final Replays.ParsedEntry e : entries) {
            if (e.failed()) {
                out.add(new String[]{e.sourceName(), e.failureMessage()});
            }
        }
        return out;
    }
}
