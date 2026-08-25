package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * 真实回放 158布丁 型 Assist median-collapse 复现 probe（可重复运行，无样本自动跳过）：
 * 对本地 {@code common/data}（含 34冠军赛回放 子目录）跑真实 {@link LeagueReplays#collect}，
 * 输出指定账号每场 damageAssisted / assistScore，并计算 assistScore 的 median 与 mean——
 * 用于验证「Summary Radar 旧取 dimensionMedians → 稀疏 Assist 显示 0」的 root cause，
 * 以及新 {@code dimensionMeans} 契约（Radar 必须显示 mean）。
 */
@Tag("probe")
class LeagueReplayAssistProbeTest {

    /** CHRD-A158布丁（158布丁）在真实样本中的稳定 accountId。 */
    private static final long TARGET_ACCOUNT = 3115055801L;

    @Test
    void probeSparseAssistMedianVsMeanForRealPlayer() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common", "data").normalize();
        if (!Files.isDirectory(common)) {
            System.out.println("\n===== SKIP（common/data 无真实回放样本）: LeagueReplayAssistProbeTest");
            return;
        }
        final List<Source> sources = new ArrayList<>();
        try (Stream<Path> top = Files.list(common)) {
            for (final Path p : top.toList()) {
                if (p.getFileName().toString().endsWith(".wotbreplay")) {
                    sources.add(new Source(p.getFileName().toString(), Files.readAllBytes(p)));
                } else if (Files.isDirectory(p)) {
                    try (Stream<Path> sub = Files.list(p)) {
                        for (final Path q : sub.filter(f -> f.getFileName().toString().endsWith(".wotbreplay")).toList()) {
                            sources.add(new Source(q.getFileName().toString(), Files.readAllBytes(q)));
                        }
                    }
                }
            }
        }
        if (sources.isEmpty()) {
            System.out.println("\n===== SKIP（common/data 无 .wotbreplay）: LeagueReplayAssistProbeTest");
            return;
        }
        System.out.println("\n===== LeagueReplayAssistProbeTest（样本数=" + sources.size()
                + "，目标账号=" + TARGET_ACCOUNT + "）=====");
        final LeagueReplays.LeagueCollectResult c = LeagueReplays.collect(
                sources, s -> ReplayParser.parse(s.bytes()), null, null);
        System.out.println("parsed=" + c.battles().size() + " rated="
                + c.leagueBatch().battleResults().size() + " leagueFailures="
                + c.leagueFailures().size() + " duplicates=" + c.duplicates().size());

        final List<Double> assistScores = new ArrayList<>();
        for (final Battle battle : c.battles()) {
            final LeagueRatingResult result = c.leagueBatch().resultFor(battle.arenaId);
            final PlayerLeagueRating plr = result == null ? null : result.byAccount(TARGET_ACCOUNT);
            if (plr == null) {
                continue;
            }
            final com.wotb.core.model.PlayerResult raw = battle.players.stream()
                    .filter(p -> p.accountId == TARGET_ACCOUNT).findFirst().orElse(null);
            final double score = plr.assistScore();
            assistScores.add(score);
            System.out.printf("arenaId=%-24s damageAssisted=%-6d assistScore=%.4f%n",
                    battle.arenaId, raw == null ? -1 : raw.damageAssisted, score);
        }
        if (assistScores.isEmpty()) {
            System.out.println("目标账号未出现在任何 rated battle 中");
            return;
        }
        final double median = LeagueRatingBatchAggregator.median(assistScores);
        final double mean = assistScores.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        System.out.printf("ratedBattles=%d assistScoreMedian=%.4f assistScoreMean=%.4f%n",
                assistScores.size(), median, mean);
        System.out.println("assistScores=" + assistScores.stream().sorted(Comparator.naturalOrder()).toList());
    }
}
