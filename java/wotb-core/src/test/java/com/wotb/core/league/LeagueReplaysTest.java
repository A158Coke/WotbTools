package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.parse.Replays;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 模式判定 / 去重 / 冲突 / 校验失败（plan §2、§4、§21.3）。 */
class LeagueReplaysTest {

    private static Source source(final String name, final Battle battle, final int arenaBonusType) throws Exception {
        return new Source(name, LeagueTestBattles.replayBytes(battle, arenaBonusType));
    }

    private static LeagueReplays.LeagueCollectResult collect(final List<Source> sources) {
        return LeagueReplays.collect(sources, source -> ReplayParser.parse(source.bytes()), null, null);
    }

    @Test
    void singleTrainingBattleIsLeagueRated() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "111";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("a.wotbreplay", battle, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueBatch().battleResults().size());
        assertTrue(r.leagueBatch().battleResults().getFirst().rated());
    }

    @Test
    void tournamentBattleIsLeagueRated() throws Exception {
        final Battle battle = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("b.wotbreplay", battle, 4)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
    }

    @Test
    void standardRandomBattleHasNoLeagueRating() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "333";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("c.wotbreplay", battle, 1)));
        assertEquals(LeagueRatingMode.STANDARD_REPLAY, r.mode());
        assertEquals(1, r.battles().size());
        assertNull(r.leagueBatch());
    }

    @Test
    void inGameRatingBattleIsStandard() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "444";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(source("d.wotbreplay", battle, 7)));
        assertEquals(LeagueRatingMode.STANDARD_REPLAY, r.mode());
        assertNull(r.leagueBatch());
    }

    @Test
    void trainingPlusTournamentBatchAllowed() throws Exception {
        final Battle t = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        t.arenaId = "111";
        final Battle t2 = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        t2.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("t.wotbreplay", t, 2), source("t2.wotbreplay", t2, 4)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size());
        assertEquals(2, r.leagueBatch().battleResults().size());
    }

    @Test
    void trainingPlusRandomIsMixed() throws Exception {
        final Battle t = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        t.arenaId = "111";
        final Battle rand = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        rand.arenaId = "999";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("t.wotbreplay", t, 2), source("r.wotbreplay", rand, 1)));
        assertEquals(LeagueRatingMode.MIXED_UNSUPPORTED, r.mode());
        assertTrue(r.battles().isEmpty());
        // 每个文件恰好一次 progress
        final List<String> outcomes = new ArrayList<>();
        LeagueReplays.collect(List.of(source("t.wotbreplay", t, 2), source("r.wotbreplay", rand, 1)),
                source -> ReplayParser.parse(source.bytes()), null, (s, o) -> outcomes.add(s.name() + ":" + o));
        assertEquals(2, outcomes.size());
        assertTrue(outcomes.stream().allMatch(o -> o.endsWith(":FAILURE")));
    }

    @Test
    void sameArenaConsistentCopiesDeduplicate() throws Exception {
        final Battle battle = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        battle.arenaId = "111";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("a.wotbreplay", battle, 2), source("a2.wotbreplay", battle, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
        assertEquals(1, r.duplicates().size());
        assertTrue(r.leagueFailures().isEmpty());
    }

    @Test
    void sameArenaConflictingCopiesRejected() throws Exception {
        final Battle a = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        a.arenaId = "111";
        final Battle b = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b.arenaId = "111";
        b.winnerTeam = 2; // 关键事实冲突
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("a.wotbreplay", a, 2), source("b.wotbreplay", b, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertTrue(r.battles().isEmpty());
        assertEquals(2, r.leagueFailures().size());
        assertTrue(r.leagueFailures().stream()
                .allMatch(f -> f.code().equals(LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA)));
    }

    @Test
    void invalidSevenVsSevenReportedAsFailureOthersContinue() throws Exception {
        final Battle bad = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        bad.arenaId = "111";
        bad.players.remove(0); // 13 人
        final Battle good = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        good.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("bad.wotbreplay", bad, 2), source("good.wotbreplay", good, 2)));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueFailures().size());
        assertEquals(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN, r.leagueFailures().getFirst().code());
        assertEquals("bad.wotbreplay", r.leagueFailures().getFirst().fileName());
    }

    @Test
    void parseFailureReportedAsFailure() throws Exception {
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                new Source("broken.wotbreplay", new byte[]{1, 2, 3})));
        assertEquals(LeagueRatingMode.STANDARD_REPLAY, r.mode());
        assertEquals(1, r.failures().size());
        assertEquals("broken.wotbreplay", r.failures().getFirst()[0]);
    }
}
