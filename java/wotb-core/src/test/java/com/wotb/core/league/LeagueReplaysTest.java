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
    void trainingPlusRandomIsMixedKeepsParsedBattles() throws Exception {
        // plan §21/Case I：混合批次不再整体拒绝——League Rating 不聚合，但全部可解析
        // replay 仍按普通回放语义成功返回（battles 保留、无 leagueBatch、progress 真实 outcome）。
        final Battle t = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        t.arenaId = "111";
        final Battle rand = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        rand.arenaId = "999";
        final LeagueReplays.LeagueCollectResult r = collect(List.of(
                source("t.wotbreplay", t, 2), source("r.wotbreplay", rand, 1)));
        assertEquals(LeagueRatingMode.MIXED_UNSUPPORTED, r.mode());
        assertEquals(2, r.battles().size(), "混合批次所有可解析 Battle 必须保留（禁止污染 Parser）");
        assertNull(r.leagueBatch(), "混合批次不产生 League Rating");
        assertTrue(r.leagueFailures().isEmpty());
        // 每个文件恰好一次 progress；已解析文件必须 SUCCESS（不得计为解析失败）
        final List<String> outcomes = new ArrayList<>();
        LeagueReplays.collect(List.of(source("t.wotbreplay", t, 2), source("r.wotbreplay", rand, 1)),
                source -> ReplayParser.parse(source.bytes()), null, (s, o) -> outcomes.add(s.name() + ":" + o));
        assertEquals(2, outcomes.size());
        assertTrue(outcomes.stream().allMatch(o -> o.endsWith(":SUCCESS")));
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
        assertEquals(2, r.battles().size(), "Rating 校验失败的场次必须保留在 battles（领域分离，P0）");
        assertTrue(r.battles().stream().anyMatch(b -> b.arenaId.equals("111")),
                "bad 场（13 人）必须仍存在于 battles");
        assertEquals(1, r.leagueBatch().battleResults().size(), "Rating 只对 eligible 场次计算");
        assertEquals(1, r.leagueFailures().size());
        assertEquals(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN, r.leagueFailures().getFirst().code());
        assertEquals("bad.wotbreplay", r.leagueFailures().getFirst().fileName());
    }

    // ---- P0 回归：replay parsing validity != league rating eligibility ----
    // 直接 loader 返回构造好的 Battle（绕过 parser 字节往返），精确测试校验/保留/评分语义。

    private static LeagueReplays.LeagueCollectResult collectBattles(final List<Battle> battles) {
        final List<Source> sources = new ArrayList<>();
        for (int i = 0; i < battles.size(); i++) {
            sources.add(new Source("r" + i + ".wotbreplay", new byte[]{(byte) i}));
        }
        return LeagueReplays.collect(sources, source -> {
            final int idx = Integer.parseInt(source.name().substring(1, source.name().indexOf('.')));
            return battles.get(idx);
        }, null, null);
    }

    @Test
    void caseA_allParsedAndAllEligible() throws Exception {
        final Battle a = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        a.arenaId = "111";
        final Battle b = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        b.arenaId = "222";
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(a, b));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size());
        assertEquals(2, r.leagueBatch().battleResults().size());
        assertEquals(0, r.leagueFailures().size());
        assertTrue(r.leagueBatch().battleResults().stream().allMatch(LeagueRatingResult::rated));
    }

    @Test
    void caseB_partialRatingIneligibleBattleKeptWithFailure() throws Exception {
        final Battle good = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        good.arenaId = "111";
        final Battle bad = LeagueTestBattles.battle(2, LeagueTestBattles.defaultSevenVsSeven());
        bad.arenaId = "222";
        bad.rosterComplete = false; // ROSTER_INCOMPLETE
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(good, bad));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(2, r.battles().size(), "Rating 不合格的 Battle 必须保留在解析结果");
        assertEquals(2, r.battleSourceNames().size());
        assertTrue(r.battles().stream().anyMatch(b -> b.arenaId.equals("222")),
                "bad 场必须仍存在于 battles");
        assertEquals(1, r.leagueBatch().battleResults().size(), "Rating 只对 eligible 场次计算");
        assertEquals(1, r.leagueFailures().size());
        assertEquals(LeagueFailure.Code.ROSTER_INCOMPLETE, r.leagueFailures().getFirst().code());
        assertEquals("r1.wotbreplay", r.leagueFailures().getFirst().fileName());
    }

    @Test
    void caseC_allRatingIneligibleAllBattlesStillParsed() throws Exception {
        // MISSING_DEATH_TIME：一名阵亡玩家死亡时间为 0（非正有限）
        final List<LeagueTestBattles.PlayerSpec> deathSpecs = LeagueTestBattles.defaultSevenVsSeven();
        deathSpecs.getFirst().dead(0);
        final Battle death = LeagueTestBattles.battle(1, deathSpecs);
        death.arenaId = "111";
        // ROSTER_INCOMPLETE
        final Battle roster = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        roster.arenaId = "222";
        roster.rosterComplete = false;
        // NO_DECISIVE_WINNER
        final Battle winner = LeagueTestBattles.battle(null, LeagueTestBattles.defaultSevenVsSeven());
        winner.arenaId = "333";
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(death, roster, winner));
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode());
        assertEquals(3, r.battles().size(), "全部 Rating 不合格时所有 Battle 仍必须保留（禁止 NO_VALID_REPLAYS）");
        assertEquals(0, r.leagueBatch().battleResults().size());
        assertEquals(3, r.leagueFailures().size());
        assertTrue(r.leagueFailures().stream().anyMatch(f -> f.code().equals(LeagueFailure.Code.MISSING_DEATH_TIME)));
        assertTrue(r.leagueFailures().stream().anyMatch(f -> f.code().equals(LeagueFailure.Code.ROSTER_INCOMPLETE)));
        assertTrue(r.leagueFailures().stream().anyMatch(f -> f.code().equals(LeagueFailure.Code.NO_DECISIVE_WINNER)));
    }

    @Test
    void ratingValidationFailureReportsSuccessProgressNotFailure() {
        final Battle bad = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        bad.arenaId = "111";
        bad.rosterComplete = false;
        final List<String> outcomes = new ArrayList<>();
        final LeagueReplays.LeagueCollectResult r = LeagueReplays.collect(
                List.of(new Source("bad.wotbreplay", new byte[]{1})),
                source -> bad, null, (s, o) -> outcomes.add(s.name() + ":" + o));
        assertEquals(1, r.battles().size());
        assertEquals(1, r.leagueFailures().size());
        assertEquals(List.of("bad.wotbreplay:SUCCESS"), outcomes,
                "Rating-ineligible 但已解析的 replay 必须报 SUCCESS（不得计入解析失败，plan §18）");
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
