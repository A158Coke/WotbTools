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
 * <p><b>领域分离（P0 修复）</b>：{@link LeagueCollectResult#battles()} 返回<b>全部</b>成功解析
 * 并通过去重/冲突规则的 Battle（可进入 Preview/Export 的基础数据）；League Rating <b>只</b>对
 * 通过 {@link LeagueRatingValidator} 完整性校验的场次计算（{@link LeagueRatingBatch#battleResults()}
 * 与汇总均只含 eligible 场次）。Rating 校验失败<b>不得</b>把 Battle 从结果中移除（plan：replay
 * parsing validity != league rating eligibility），失败以 {@link LeagueFailure} 稳定错误码返回。</p>
 *
 * <p>普通模式（{@code STANDARD_REPLAY}）复用 {@link Replays} 既有 arenaId 去重语义，
 * 普通回放契约零回归；混合模式（{@code MIXED_UNSUPPORTED}）由调用方整体拒绝（HTTP 400
 * {@code MIXED_LEAGUE_AND_STANDARD_REPLAYS}）。</p>
 *
 * <p>league 去重范围仅限当前上传批次（plan §4）：同一 arenaId 多份回放关键事实一致 →
 * 只计一份、其余进 duplicates；不一致 → 该场全部副本拒绝评分（{@code CONFLICTING_REPLAYS_FOR_ARENA}）。
 * 不采用第一份、不自动选择「字段更多」的副本；不建立持久化记录。</p>
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
            List<String[]> duplicates,
            List<String[]> failures,
            List<LeagueFailure> leagueFailures,
            LeagueRatingBatch leagueBatch) {

        public LeagueCollectResult {
            battles = battles == null ? List.of() : List.copyOf(battles);
            battleSourceNames = battleSourceNames == null ? List.of() : List.copyOf(battleSourceNames);
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
        final List<Replays.ParsedEntry> entries = Replays.parseAll(sources, loader, log);
        final LeagueRatingMode mode = LeagueRatingMode.classify(entries.stream()
                .filter(e -> !e.failed())
                .map(Replays.ParsedEntry::battle).toList());
        if (mode == LeagueRatingMode.MIXED_UNSUPPORTED) {
            // 混合批次：整个请求拒绝（调用方抛 400 MIXED_LEAGUE_AND_STANDARD_REPLAYS），
            // 不返回部分预览；progress 按文件回调 FAILURE（推进 processed）。
            for (final Replays.ParsedEntry e : entries) {
                if (progress != null) {
                    progress.onProcessed(e.source(), Replays.Outcome.FAILURE);
                }
            }
            return new LeagueCollectResult(mode, List.of(), List.of(), List.of(),
                    failuresFrom(entries), List.of(), null);
        }
        if (mode == LeagueRatingMode.STANDARD_REPLAY) {
            final com.wotb.core.model.Collected c = Replays.dedupe(entries, log, progress);
            return new LeagueCollectResult(mode, c.battles, c.battleSourceNames, c.duplicates,
                    c.failures, List.of(), null);
        }
        return collectLeague(entries, progress);
    }

    /**
     * league 分支：去重/冲突 → 校验 → 评分 → 汇总。
     *
     * <p>返回的 battles = 去重/冲突后<b>全部</b>成功解析的 Battle（Rating 不合格也保留，
     * 只进 leagueFailures）；ratedBattles/ratedNames/results 仅用于 League Rating 计算与
     * 批次聚合（plan §6：aggregate 只基于 eligible 场次）。</p>
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
        final List<String[]> duplicates = new ArrayList<>();
        final List<LeagueFailure> leagueFailures = new ArrayList<>();
        final List<String> conflictedArenas = new ArrayList<>();

        for (final Map.Entry<String, List<Replays.ParsedEntry>> group : byArena.entrySet()) {
            final List<Replays.ParsedEntry> copies = group.getValue();
            final boolean conflicted = copies.size() > 1 && !consistent(copies);
            if (conflicted) {
                conflictedArenas.add(group.getKey());
                for (final Replays.ParsedEntry copy : copies) {
                    leagueFailures.add(new LeagueFailure(copy.source().name(), group.getKey(),
                            LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA));
                }
                continue;
            }
            // 一致：只保留第一份，其余进 duplicates
            final Replays.ParsedEntry kept = copies.getFirst();
            for (int i = 1; i < copies.size(); i++) {
                duplicates.add(new String[]{copies.get(i).source().name(), group.getKey()});
            }
            battles.add(kept.battle());
            battleSourceNames.add(kept.source().name());
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
                    outcomeBySource.put(e.source().name(), Replays.Outcome.FAILURE);
                    continue;
                }
                if (conflictedArenas.contains(e.battle().arenaId)) {
                    outcomeBySource.put(e.source().name(), Replays.Outcome.FAILURE);
                    continue;
                }
                if (duplicates.stream().anyMatch(d -> d[0].equals(e.source().name()))) {
                    outcomeBySource.put(e.source().name(), Replays.Outcome.DUPLICATE);
                    continue;
                }
                outcomeBySource.put(e.source().name(), Replays.Outcome.SUCCESS);
            }
            for (final Replays.ParsedEntry e : entries) {
                progress.onProcessed(e.source(), outcomeBySource.get(e.source().name()));
            }
        }

        return new LeagueCollectResult(LeagueRatingMode.LEAGUE_RATING,
                battles, battleSourceNames, duplicates,
                failuresFrom(entries), leagueFailures, batch);
    }

    /** 多份同 arenaId 副本是否全部关键事实一致。 */
    private static boolean consistent(final List<Replays.ParsedEntry> copies) {
        final Battle first = copies.getFirst().battle();
        for (int i = 1; i < copies.size(); i++) {
            if (!LeagueRatingConflictDetector.consistent(first, copies.get(i).battle())) {
                return false;
            }
        }
        return true;
    }

    private static List<String[]> failuresFrom(final List<Replays.ParsedEntry> entries) {
        final List<String[]> out = new ArrayList<>();
        for (final Replays.ParsedEntry e : entries) {
            if (e.failed()) {
                out.add(new String[]{e.source().name(), e.failureMessage()});
            }
        }
        return out;
    }
}
