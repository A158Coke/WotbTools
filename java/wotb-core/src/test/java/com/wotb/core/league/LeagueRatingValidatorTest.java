package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.List;

import static com.wotb.core.league.LeagueTestBattles.defaultSevenVsSeven;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** League Rating 完整性门槛测试。 */
class LeagueRatingValidatorTest {

    private static List<String> codes(final Battle battle) {
        return LeagueRatingValidator.validate(battle).stream().map(LeagueFailure::code).toList();
    }

    @Test
    void acceptsStandardSevenVsSeven() {
        final Battle battle = LeagueTestBattles.battle(1, defaultSevenVsSeven());
        assertTrue(LeagueRatingValidator.validate(battle).isEmpty());
    }

    @Test
    void acceptsLegalZeroStats() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        // 合法零伤害/零助攻/零阻挡/零占点：缺失与零值同等对待，不得误拒绝
        specs.set(0, specs.get(0).damage(0).assist(0).blocked(0).points(0, 0));
        specs.set(7, specs.get(7).damage(0).assist(0).blocked(0).points(0, 0));
        final Battle battle = LeagueTestBattles.battle(1, specs);
        assertTrue(LeagueRatingValidator.validate(battle).isEmpty());
    }

    @Test
    void rejectsThirteenOrFifteenPlayers() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.remove(0);
        assertEquals(List.of(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN),
                codes(LeagueTestBattles.battle(1, specs)));
        specs.add(new LeagueTestBattles.PlayerSpec(3001, 1));
        specs.add(new LeagueTestBattles.PlayerSpec(3002, 1));
        assertEquals(List.of(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsTeamsNotSevenVsSeven() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.remove(0); // 队1 6 人
        specs.add(new LeagueTestBattles.PlayerSpec(3001, 2)); // 队2 8 人
        assertEquals(List.of(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsTeamNotOneOrTwo() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).team = 9;
        assertEquals(List.of(LeagueFailure.Code.INVALID_TEAM),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsDuplicateAccountId() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.set(7, new LeagueTestBattles.PlayerSpec(1001, 2));
        assertEquals(List.of(LeagueFailure.Code.DUPLICATE_ACCOUNT_ID),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsZeroAccountId() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).accountId = 0;
        assertEquals(List.of(LeagueFailure.Code.DUPLICATE_ACCOUNT_ID),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsMissingTank() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).tankId = 0;
        assertEquals(List.of(LeagueFailure.Code.MISSING_TANK),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsIncompleteRoster() {
        final Battle battle = LeagueTestBattles.battle(1, defaultSevenVsSeven());
        battle.settlementAccountsCoveredByRoster = false;
        assertEquals(List.of(LeagueFailure.Code.ROSTER_INCOMPLETE),
                codes(battle));
    }

    @Test
    void rejectsNullRosterComplete() {
        final Battle battle = LeagueTestBattles.battle(1, defaultSevenVsSeven());
        battle.settlementAccountsCoveredByRoster = null;
        assertEquals(List.of(LeagueFailure.Code.ROSTER_INCOMPLETE),
                codes(battle));
    }

    @Test
    void rejectsUnknownWinner() {
        final Battle battle = LeagueTestBattles.battle(null, defaultSevenVsSeven());
        assertEquals(List.of(LeagueFailure.Code.NO_DECISIVE_WINNER),
                codes(battle));
    }

    @Test
    void rejectsDraw() {
        final Battle battle = LeagueTestBattles.battle(0, defaultSevenVsSeven());
        assertEquals(List.of(LeagueFailure.Code.NO_DECISIVE_WINNER),
                codes(battle));
    }

    @Test
    void acceptsDeadPlayerWithUnknownDeathTime() {
        // survivalTimeSec == 0 = 死亡时间 UNKNOWN（合法）：不产生 failure，整场允许评分
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).dead(0);
        assertTrue(LeagueRatingValidator.validate(LeagueTestBattles.battle(1, specs)).isEmpty());
    }

    @Test
    void rejectsNegativeDeathTime() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).dead(-1);
        assertEquals(List.of(LeagueFailure.Code.INVALID_STAT_FACTS),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsNaNDeathTime() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).survived = false;
        specs.get(0).survivalTimeSec = Double.NaN;
        assertEquals(List.of(LeagueFailure.Code.INVALID_STAT_FACTS),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsInfiniteDeathTime() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).survived = false;
        specs.get(0).survivalTimeSec = Double.POSITIVE_INFINITY;
        assertEquals(List.of(LeagueFailure.Code.INVALID_STAT_FACTS),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsNegativeStats() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = -1;
        assertEquals(List.of(LeagueFailure.Code.INVALID_STAT_FACTS),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsHitsGreaterThanShots() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).shots = 3;
        specs.get(0).hits = 5;
        assertEquals(List.of(LeagueFailure.Code.INVALID_STAT_FACTS),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsPensGreaterThanHits() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).hits = 2;
        specs.get(0).pens = 4;
        assertEquals(List.of(LeagueFailure.Code.INVALID_STAT_FACTS),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsDeadTimeBeyondDuration() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).survived = false;
        specs.get(0).survivalTimeSec = 400;
        assertEquals(List.of(LeagueFailure.Code.INVALID_STAT_FACTS),
                codes(LeagueTestBattles.battle(1, specs)));
    }

    @Test
    void rejectsMissingArenaId() {
        final Battle battle = LeagueTestBattles.battle(1, defaultSevenVsSeven());
        battle.arenaId = "";
        assertEquals(List.of(LeagueFailure.Code.ARENA_ID_MISSING),
                codes(battle));
    }

    @Test
    void multipleFailuresReportedInOrder() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.remove(0); // 13 人
        specs.get(0).accountId = 0; // 非法账号
        final Battle battle = LeagueTestBattles.battle(null, specs); // 无胜方
        final List<String> codes = codes(battle);
        assertEquals(LeagueFailure.Code.NOT_SEVEN_VS_SEVEN, codes.getFirst());
        assertTrue(codes.contains(LeagueFailure.Code.DUPLICATE_ACCOUNT_ID));
        assertTrue(codes.contains(LeagueFailure.Code.NO_DECISIVE_WINNER));
    }
}
