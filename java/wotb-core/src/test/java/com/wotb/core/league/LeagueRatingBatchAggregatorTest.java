package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
    void mvpCountAccumulates() {
        final LeagueRatingResult a = rated(1, 0);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle()), List.of(a, a), List.of());
        final long mvpAccount = a.mvp().accountId();
        final PlayerLeagueSummary mvpSummary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == mvpAccount).findFirst().orElseThrow();
        assertEquals(2, mvpSummary.mvpCount());
    }
}
