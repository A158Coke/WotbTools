package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

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

    @Test
    void canonical34ArenaGoldenRegression() {
        final GoldenFixture fixture = canonical34ArenaFixture();
        final int playerGames = fixture.results.stream().mapToInt(r -> r.players().size()).sum();
        final Set<Long> accountIds = new HashSet<>();
        fixture.results.forEach(r -> r.players().forEach(p -> accountIds.add(p.accountId())));

        assertEquals(34, fixture.battles.size());
        assertEquals(34, fixture.results.size());
        assertEquals(476, playerGames);
        assertEquals(32, accountIds.size());

        final LeagueRatingBatch batch = LeagueRatingBatchAggregator.aggregate(
                fixture.battles, fixture.results, List.of());
        final PlayerLeagueSummary player = batch.playerSummaries().stream()
                .filter(p -> p.accountId() == 5001L).findFirst().orElseThrow();
        final TeamLeagueSummary team = batch.teamSummaries().stream()
                .filter(t -> t.teamKey().equals("clan:ALPHA")).findFirst().orElseThrow();

        assertEquals(15, player.ratedBattles());
        assertEquals(400.2416666666667, player.observedMean(), 1e-12);
        assertEquals(418.93125, player.rating(), 1e-12);
        assertEquals(10.0, player.dimensionMeans().getFirst(), 1e-12);
        assertEquals(34, team.ratedBattles());
        assertEquals(602.1617647058823, team.observedMean(), 1e-12);
        assertEquals(598.5285714285715, team.rating(), 1e-12);
        assertEquals(102.65, team.dimensionMeans().getFirst(), 1e-12);
    }

    private static GoldenFixture canonical34ArenaFixture() {
        final List<Battle> battles = new ArrayList<>();
        final List<LeagueRatingResult> results = new ArrayList<>();
        for (int arena = 0; arena < 34; arena++) {
            final List<PlayerLeagueRating> players = new ArrayList<>();
            for (int slot = 0; slot < 14; slot++) {
                final int playerIndex = (arena * 14 + slot) % 32;
                final int team = slot < 7 ? 1 : 2;
                final double finalRating = 400.0 + playerIndex * 7.25 + (arena % 5) * 0.125;
                final List<Double> dimensions = List.of(
                        10.0 + playerIndex, 20.0 + playerIndex, 30.0 + playerIndex,
                        40.0 + playerIndex, 5.0 + playerIndex, 6.0 + playerIndex,
                        7.0 + playerIndex);
                players.add(new PlayerLeagueRating(
                        5001L + playerIndex, "G" + (5001L + playerIndex),
                        team == 1 ? "ALPHA" : "BRAVO", team,
                        dimensions.get(0), dimensions.get(1), dimensions.get(2),
                        dimensions.get(3), dimensions.get(4), dimensions.get(5), dimensions.get(6),
                        finalRating, finalRating, finalRating, "NONE",
                        1000, 100, 1, true, false, false));
            }
            final Battle battle = new Battle();
            battle.arenaId = "golden-" + String.format("%02d", arena + 1);
            battle.winnerTeam = 1;
            battle.players = List.of();
            final TeamLeagueRating alpha = goldenTeam(1, arena, players.subList(0, 7));
            final TeamLeagueRating bravo = goldenTeam(2, arena, players.subList(7, 14));
            battles.add(battle);
            results.add(new LeagueRatingResult(battle.arenaId, players, alpha, bravo,
                    players.getFirst(), true));
        }
        return new GoldenFixture(battles, results);
    }

    private static TeamLeagueRating goldenTeam(final int team, final int arena,
                                                final List<PlayerLeagueRating> players) {
        final double rating = (team == 1 ? 600.0 : 500.0) + (arena % 4) * 1.5;
        return new TeamLeagueRating(team, rating,
                List.of(100.0 + team + arena * 0.1, 20.0 + team, 30.0 + team,
                        40.0 + team, 5.0 + team, 6.0 + team, 7.0 + team),
                team == 1 ? "ALPHA" : "BRAVO", "CLAN_MAJORITY",
                players.getFirst(), players);
    }

    private record GoldenFixture(List<Battle> battles, List<LeagueRatingResult> results) {
    }

    private static List<LeagueTestBattles.PlayerSpec> withDamage(final int damage) {
        final List<LeagueTestBattles.PlayerSpec> specs = LeagueTestBattles.defaultSevenVsSeven();
        specs.getFirst().damage(damage);
        return specs;
    }
}
