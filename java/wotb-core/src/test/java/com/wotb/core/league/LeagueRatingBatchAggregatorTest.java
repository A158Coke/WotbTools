package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** V6 batch aggregation and team identity contract. */
class LeagueRatingBatchAggregatorTest {

    private static LeagueRatingResult rated(final int winner, final int offset) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        for (final LeagueTestBattles.PlayerSpec s : specs) {
            s.accountId += offset;
            s.nickname = "P" + s.accountId;
        }
        return LeagueRatingCalculator.calculate(LeagueTestBattles.battle(winner, specs));
    }

    @Test
    void playerUsesRawSumCountAndObservedMean() {
        final LeagueRatingResult low = LeagueRatingCalculator.calculate(
                LeagueTestBattles.battle(1, withDamage(300)));
        final LeagueRatingResult mid = LeagueRatingCalculator.calculate(
                LeagueTestBattles.battle(1, withDamage(900)));
        final LeagueRatingResult high = LeagueRatingCalculator.calculate(
                LeagueTestBattles.battle(1, withDamage(2000)));
        final double lowRating = low.byAccount(1001).finalRating();
        final double midRating = mid.byAccount(1001).finalRating();
        final double highRating = high.byAccount(1001).finalRating();
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle(), new Battle()), List.of(low, mid, high), List.of());
        final PlayerLeagueSummary summary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        final double sum = lowRating + midRating + highRating;
        assertEquals(3, summary.ratedBattles());
        assertEquals(sum / 3.0, summary.observedMean(), 1e-9);
        assertEquals((sum + 2375.0) / 8.0, summary.rating(), 1e-9);
        assertTrue(lowRating < midRating && midRating < highRating);
    }

    @Test
    void teamUsesTeamBattleSumCountAndMeans() {
        final LeagueRatingResult a = rated(1, 0);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle()), List.of(a, a), List.of());
        final TeamLeagueSummary team = batch.teamSummaries().stream()
                .filter(t -> t.teamKey().equals("clan:AAA")).findFirst().orElseThrow();
        assertEquals(2, team.ratedBattles());
        assertEquals(a.team1().teamRating(), team.observedMean(), 1e-9);
        assertEquals((2 * a.team1().teamRating() + 475.0) / 3.0, team.rating(), 1e-9);
        assertEquals(a.team1().dimensionAverages(), team.dimensionMeans());
    }

    @Test
    void teamKeyPrefersClanMajorityElseArenaTeam() {
        final LeagueRatingResult a = rated(1, 0);
        final Battle named = new Battle();
        named.arenaId = "arena-1";
        final LeagueRatingBatch namedBatch = LeagueRatingBatchAggregator.aggregate(
                List.of(named), List.of(a), List.of());
        assertTrue(namedBatch.teamSummaries().stream().anyMatch(t -> t.teamKey().equals("clan:AAA")));
        assertTrue(namedBatch.teamSummaries().stream().anyMatch(t -> t.teamKey().equals("clan:BBB")));

        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        specs.forEach(s -> s.clan = "");
        final LeagueRatingResult unnamed = LeagueRatingCalculator.calculate(
                LeagueTestBattles.battle(1, specs));
        final Battle fallback = new Battle();
        fallback.arenaId = "arena-77";
        final LeagueRatingBatch fallbackBatch = LeagueRatingBatchAggregator.aggregate(
                List.of(fallback), List.of(unnamed), List.of());
        assertTrue(fallbackBatch.teamSummaries().stream().anyMatch(t -> t.teamKey().equals("arena-77:1")));
        assertTrue(fallbackBatch.teamSummaries().stream().anyMatch(t -> t.teamKey().equals("arena-77:2")));
    }

    @Test
    void dimensionsUseArithmeticMeansIncludingRealZeros() {
        final List<LeagueRatingResult> results = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
            specs.getFirst().assist(i < 4 ? 0 : 5000);
            results.add(LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs)));
        }
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                Collections.nCopies(6, new Battle()), results, List.of());
        final PlayerLeagueSummary summary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(6, summary.ratedBattles());
        assertEquals(110.0 / 3.0, summary.dimensionMeans().get(1), 1e-9);
    }

    @Test
    void ratedFalseResultsAreExcludedFromAllAggregateState() {
        final LeagueRatingResult rated = rated(1, 0);
        final LeagueRatingResult rejected = new LeagueRatingResult(rated.arenaId(), rated.players(),
                rated.team1(), rated.team2(), rated.mvp(), false);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle()), List.of(rated, rejected), List.of());
        final PlayerLeagueSummary summary = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(1, summary.ratedBattles());
    }

    @Test
    void uploadOrderAndChunkPartitionDoNotChangeProjection() {
        final LeagueRatingResult low = LeagueRatingCalculator.calculate(
                LeagueTestBattles.battle(1, withDamage(300)));
        final LeagueRatingResult mid = LeagueRatingCalculator.calculate(
                LeagueTestBattles.battle(1, withDamage(1500)));
        final LeagueRatingResult high = LeagueRatingCalculator.calculate(
                LeagueTestBattles.battle(1, withDamage(3000)));
        final LeagueRatingBatch forward = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle(), new Battle()), List.of(low, mid, high), List.of());
        final LeagueRatingBatch reversed = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle(), new Battle()), List.of(high, mid, low), List.of());
        final PlayerLeagueSummary f = forward.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        final PlayerLeagueSummary r = reversed.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        assertEquals(f.rating(), r.rating(), 1e-9);
        assertEquals(f.observedMean(), r.observedMean(), 1e-9);
        assertEquals(f.dimensionMeans(), r.dimensionMeans());
        final double sum = low.byAccount(1001).finalRating()
                + mid.byAccount(1001).finalRating() + high.byAccount(1001).finalRating();
        assertEquals(LeagueBatchRatingCalculator.playerRating(sum, 3), f.rating(), 1e-9);
    }

    @Test
    void rotationPlayersUseOwnRatedBattleCount() {
        final LeagueRatingResult a = rated(1, 0);
        final LeagueRatingResult b = rated(1, 0);
        final LeagueRatingResult c = rated(2, 100000);
        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                List.of(new Battle(), new Battle(), new Battle()), List.of(a, b, c), List.of());
        final PlayerLeagueSummary p1001 = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 1001L).findFirst().orElseThrow();
        final PlayerLeagueSummary p101001 = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 101001L).findFirst().orElseThrow();
        assertEquals(2, p1001.ratedBattles());
        assertEquals(1, p101001.ratedBattles());
        assertEquals(LeagueBatchRatingCalculator.playerRating(
                2 * a.byAccount(1001).finalRating(), 2), p1001.rating(), 1e-9);
        assertEquals(LeagueBatchRatingCalculator.playerRating(
                c.byAccount(101001).finalRating(), 1), p101001.rating(), 1e-9);
    }

    private static List<LeagueTestBattles.PlayerSpec> withDamage(final int damage) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        specs.getFirst().damage(damage);
        return specs;
    }
}
