package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** 批次选手/战队中位数汇总（plan §17）。 */
class LeagueRatingBatchAggregatorTest {

    private static LeagueRatingResult rated(final int winner, final int offset) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        for (final LeagueTestBattles.PlayerSpec s : specs) {
            s.accountId += offset;
            s.nickname = "P" + s.accountId;
        }
        final Battle battle = LeagueTestBattles.battle(winner, specs);
        return LeagueRatingCalculator.calculate(battle);
    }

    @Test
    void oddNumberOfBattlesUsesMiddleValue() {
        final LeagueRatingResult a = rated(1, 0);
        final LeagueRatingResult b = rated(2, 100000);
        final LeagueRatingResult c = rated(1, 200000);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle(), new Battle()),
                List.of(a, b, c), List.of());
        // 选手 1001 出现在 a（off 0）与 b（off 100000 → 101001）? 不 —— 账号各不相同
        // 构造同账号三场：直接取同一场结果三次
        final LeagueRatingBatch same = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle(), new Battle()),
                List.of(a, a, a), List.of());
        final PlayerLeagueSummary summary = same.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(3, summary.battles());
        // 三场相同分数 → 中位数 = 该分数
        assertEquals(a.byAccount(1001).finalRating(), summary.ratingMedian(), 1e-9);
    }

    @Test
    void evenNumberOfBattlesAveragesMiddleTwo() {
        final LeagueRatingResult a = rated(1, 0);
        final Battle dummy = new Battle();
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(dummy, dummy), List.of(a, a), List.of());
        final PlayerLeagueSummary summary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(2, summary.battles());
        assertEquals(a.byAccount(1001).finalRating(), summary.ratingMedian(), 1e-9);
    }

    @Test
    void teamKeyPrefersClanMajorityElseArenaTeam() {
        final LeagueRatingResult a = rated(1, 0);
        final Battle dummy = new Battle();
        dummy.arenaId = "arena-1";
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(dummy), List.of(a), List.of());
        final List<TeamLeagueSummary> teams = batch.teamSummaries();
        assertEquals(2, teams.size());
        // 默认规格队1 全员 clan=AAA（7 人多数）→ clan:AAA
        assertTrue(teams.stream().anyMatch(t -> t.teamKey().equals("clan:AAA")));
        assertTrue(teams.stream().anyMatch(t -> t.teamKey().equals("clan:BBB")));
    }

    @Test
    void noMajorityClanFallsBackToArenaTeamKey() {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        for (final LeagueTestBattles.PlayerSpec s : specs) {
            s.clan = "";
        }
        final Battle battle = LeagueTestBattles.battle(1, specs);
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);
        final Battle dummy = new Battle();
        dummy.arenaId = "arena-77";
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(dummy), List.of(result), List.of());
        assertTrue(batch.teamSummaries().stream().anyMatch(t -> t.teamKey().equals("arena-77:1")));
        assertTrue(batch.teamSummaries().stream().anyMatch(t -> t.teamKey().equals("arena-77:2")));
    }

    @Test
    void medianIsNotArithmeticMeanAcrossDistinctValues() {
        // 契约锁定：多场 Rating 汇总 = median（奇数取中间，偶数取两中间平均），
        // 禁止整体 arithmetic mean。构造同一选手三场不同 finalRating（damage 单调递增），
        // median 必须等于中间值，mean 必须不同——防止未来改回平均数。
        final List<LeagueTestBattles.PlayerSpec> low = LeagueTestBattles.defaultSevenVsSeven();
        low.getFirst().damage(300);
        final List<LeagueTestBattles.PlayerSpec> mid = LeagueTestBattles.defaultSevenVsSeven();
        mid.getFirst().damage(900);
        final List<LeagueTestBattles.PlayerSpec> high = LeagueTestBattles.defaultSevenVsSeven();
        high.getFirst().damage(2000);
        final LeagueRatingResult rLow = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, low));
        final LeagueRatingResult rMid = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, mid));
        final LeagueRatingResult rHigh = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, high));
        final double lowRating = rLow.byAccount(1001).finalRating();
        final double midRating = rMid.byAccount(1001).finalRating();
        final double highRating = rHigh.byAccount(1001).finalRating();
        assertTrue(lowRating < midRating && midRating < highRating, "damage 单调 → Rating 单调");

        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle(), new Battle()),
                List.of(rLow, rMid, rHigh), List.of());
        final PlayerLeagueSummary summary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(midRating, summary.ratingMedian(), 1e-9,
                "3 场不同 Rating → median 必须等于中间值");
        final double mean = (lowRating + midRating + highRating) / 3.0;
        assertTrue(Math.abs(summary.ratingMedian() - mean) > 1e-6,
                "median != mean（当前样本）——防止未来改回算术平均");
    }

    @Test
    void mvpCountAccumulates() {
        final LeagueRatingResult a = rated(1, 0);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle()), List.of(a, a), List.of());
        final long mvpAccount = a.mvp().accountId();
        final PlayerLeagueSummary mvpSummary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == mvpAccount).findFirst().orElseThrow();
        assertEquals(2, mvpSummary.mvpCount());
    }

    // ---- dimensionMeans：Summary Radar 平均能力画像契约（与 median 严格分离）----

    @Test
    void chunkMeansComputesPerDimensionArithmeticMean() {
        // 两场完整七维交错（battle1 + battle2 扁平拼接）：
        // [100,0,20,30,10,0,40] + [200,80,0,60,0,100,80] → means=[150,40,10,45,5,50,60]
        final List<Double> flat = List.of(
                100.0, 0.0, 20.0, 30.0, 10.0, 0.0, 40.0,
                200.0, 80.0, 0.0, 60.0, 0.0, 100.0, 80.0);
        final List<Double> expected = List.of(150.0, 40.0, 10.0, 45.0, 5.0, 50.0, 60.0);
        final List<Double> actual = LeagueRatingBatchAggregator.chunkMeans(flat);
        assertEquals(expected.size(), actual.size(), "七维数量必须与 LeagueColumns.DIM_KEYS 一致");
        for (int i = 0; i < expected.size(); i++) {
            assertEquals(expected.get(i), actual.get(i), 1e-9,
                    "维度 " + i + " mean 必须精确（禁止 stride 错位）");
        }
    }

    @Test
    void chunkMeansRejectsIncompleteDimensionStride() {
        // invariant：扁平维度样本必须是整场（stride=7）；残缺样本 fail fast，
        // 禁止静默当作 0 混入（missing 不得冒充真实 0）。
        assertThrows(IllegalStateException.class,
                () -> LeagueRatingBatchAggregator.chunkMeans(List.of(1.0, 2.0, 3.0)),
                "非整场维度样本必须 fail fast");
    }

    @Test
    void sparseAssistMedianCollapseFixedByMean() {
        // 158布丁 型回归：同账号 6 场 rated，Assist Score = [0,0,0,0,110,110]
        // （4 场 assist=0 → score 0；2 场 assist=5000 全场唯一 → score 110 = MAX_ASSIST）。
        // median = 0（超过一半场为 0）会把 Radar 画成 0/110；
        // dimensionMeans 必须 = (0+0+0+0+110+110)/6 = 36.666...（真实 0 进 mean，不过滤）。
        final List<LeagueRatingResult> results = new java.util.ArrayList<>();
        for (int i = 0; i < 6; i++) {
            final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
            specs.getFirst().assist(i < 4 ? 0 : 5000);
            results.add(LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs)));
        }
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                java.util.Collections.nCopies(6, new Battle()), results, List.of());
        final PlayerLeagueSummary summary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(6, summary.battles());
        assertEquals(0.0, summary.dimensionMedians().get(1), 1e-9,
                "Assist median 仍 = 0（Table 典型比赛得分契约保留）");
        assertEquals(110.0 / 3.0, summary.dimensionMeans().get(1), 1e-9,
                "Assist mean 必须 > 0（Radar 平均能力画像；真实 0 参与平均）");
        assertTrue(summary.dimensionMeans().get(1) > 0, "Radar Assist 不得因 median-collapse 显示 0");
    }

    @Test
    void dimensionMeansDenominatorIsRatedOnly() {
        // Rating-ineligible 场次（!result.rated()）不得进入 dimensionMeans 分母：
        // 2 场 rated + 1 场 ineligible → mean 仍按 2 场计算（不是除以 3）。
        final List<LeagueRatingResult> results = new java.util.ArrayList<>();
        final List<LeagueRatingResult> ineligible = new java.util.ArrayList<>();
        for (int i = 0; i < 2; i++) {
            final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
            specs.getFirst().assist(5000);
            final LeagueRatingResult rated = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
            results.add(rated);
            // 同场结果复制为 rated=false（模拟校验失败场次，aggregator 必须跳过）
            ineligible.add(new LeagueRatingResult(rated.arenaId(), rated.players(),
                    rated.team1(), rated.team2(), rated.mvp(), false));
        }
        final List<Battle> battles = new java.util.ArrayList<>(
                java.util.Collections.nCopies(2, new Battle()));
        battles.add(new Battle());
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                battles, java.util.Arrays.asList(results.get(0), results.get(1), ineligible.get(0)), List.of());
        final PlayerLeagueSummary summary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(2, summary.battles(), "battles = rated-only");
        assertEquals(110.0, summary.dimensionMeans().get(1), 1e-9,
                "ineligible 场不进入 mean 分母（2 场都是 110 → mean 仍 110，不是 73.33）");
    }
}
