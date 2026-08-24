package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static com.wotb.core.league.LeagueTestBattles.defaultSevenVsSeven;

/** League Rating 七维度公式 / 存活 / 最终分 / MVP（plan §8-§10、§21.1）。 */
class LeagueRatingCalculatorTest {

    /** 14 名玩家全部同统计（T=0.5、G=0.5 可精确断言）。 */
    private static Battle identicalBattle(final int winnerTeam, final boolean allDead) {
        final List<LeagueTestBattles.PlayerSpec> specs = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            final LeagueTestBattles.PlayerSpec s = new LeagueTestBattles.PlayerSpec(1000L + i, 1)
                    .damage(1000).assist(100).blocked(200).kills(2)
                    .shots(10).hits(8).pens(6).received(800).points(100, 50).clan("AAA");
            if (allDead) {
                s.survived = false;
                s.survivalTimeSec = 100;
            }
            specs.add(s);
        }
        for (int i = 1; i <= 7; i++) {
            final LeagueTestBattles.PlayerSpec s = new LeagueTestBattles.PlayerSpec(2000L + i, 2)
                    .damage(1000).assist(100).blocked(200).kills(2)
                    .shots(10).hits(8).pens(6).received(800).points(100, 50).clan("BBB");
            if (allDead) {
                s.survived = false;
                s.survivalTimeSec = 100;
            }
            specs.add(s);
        }
        return LeagueTestBattles.battle(winnerTeam, specs);
    }

    @Test
    void identicalStatsProduceExpectedDimensionScores() {
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        final PlayerLeagueRating p = r.byAccount(1001);
        // T=0.5、G=0.5 → damage=400×0.5=200 / assist=50 / kill=50 / blocked=25 / exchange=75
        assertEquals(200, p.damageScore(), 1e-6);
        assertEquals(50, p.assistScore(), 1e-6);
        assertEquals(50, p.killScore(), 1e-6);
        assertEquals(25, p.blockedScore(), 1e-6);
        assertEquals(75, p.exchangeScore(), 1e-6);
        // 射击：participation=1，conf=0.3×wilson(8,10)+0.7×wilson(6,8)
        final double conf = 0.3 * LeagueRatingNormalizer.wilsonLowerBound(8, 10)
                + 0.7 * LeagueRatingNormalizer.wilsonLowerBound(6, 8);
        assertEquals(100 * Math.min(1, conf / 0.70), p.shootingScore(), 1e-6);
        // 全部维度在 [0, max]
        assertTrue(p.damageScore() <= PlayerLeagueRating.MAX_DAMAGE);
        assertTrue(p.shootingScore() <= PlayerLeagueRating.MAX_SHOOTING);
    }

    @Test
    void winnerGetsSurvivalHundredAndMultiplier() {
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        final PlayerLeagueRating winner = r.byAccount(1001);
        final PlayerLeagueRating loser = r.byAccount(2001);
        assertEquals(LeagueRatingCalculator.STATE_WIN_SURVIVED, winner.survivalState());
        assertEquals(100, winner.survivalTradeScore(), 1e-9);
        // 胜方 ×1.05：base = prelim + 100 → final = base × 1.05（未到 1000 封顶）
        final double expectedWinner = (winner.preliminary() + 100) * 1.05;
        assertEquals(expectedWinner, winner.finalRating(), 1e-9);
        // 败方前四 +50，无倍率
        assertEquals(50, loser.survivalTradeScore(), 1e-9);
        assertEquals(loser.preliminary() + 50, loser.finalRating(), 1e-9);
        assertTrue(winner.finalRating() > loser.finalRating());
    }

    @Test
    void allZeroBattleScoresZero() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        for (final LeagueTestBattles.PlayerSpec s : specs) {
            s.damage = 0; s.assist = 0; s.blocked = 0; s.kills = 0;
            s.shots = 0; s.hits = 0; s.pens = 0; s.received = 0; s.points(0, 0);
        }
        final Battle battle = LeagueTestBattles.battle(1, specs);
        // 全员存活 → 胜方 100、败方前四 50；其余维度全 0
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(battle);
        for (final PlayerLeagueRating p : r.players()) {
            assertEquals(0, p.damageScore(), 1e-9);
            assertEquals(0, p.assistScore(), 1e-9);
            assertEquals(0, p.killScore(), 1e-9);
            assertEquals(0, p.exchangeScore(), 1e-9);
            assertEquals(0, p.blockedScore(), 1e-9);
            assertEquals(0, p.shootingScore(), 1e-9);
            assertEquals(0, p.preliminary(), 1e-9);
        }
    }

    // ---- 换血效率 ----

    @Test
    void exchangeZeroOutputIsZero() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 0;
        specs.get(0).assist = 0;
        specs.get(0).blocked = 0;
        specs.get(0).received = 500; // 只承伤不出手
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertEquals(0, r.byAccount(1001).exchangeScore(), 1e-9);
    }

    @Test
    void exchangeZeroReceivedDoesNotMaxWithoutParticipation() {
        // 少量输出 + 零承伤：参与度限制不能拿满分
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 5;   // 远低于本队平均
        specs.get(0).received = 0;
        specs.get(0).assist = 0;
        specs.get(0).blocked = 0;
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final double exchange = r.byAccount(1001).exchangeScore();
        assertTrue(exchange < PlayerLeagueRating.MAX_EXCHANGE * 0.5,
                "少量输出零承伤不应接近满分，实际 " + exchange);
    }

    @Test
    void exchangeHighAssistGetsEffectiveOutputCredit() {
        // 高助攻玩家 O = d + 0.6×assist 高于纯伤害同额玩家
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 500;
        specs.get(0).assist = 1000;
        specs.get(0).blocked = 0;
        specs.get(1).damage = 1100;  // 等效输出接近但无助攻
        specs.get(1).assist = 0;
        specs.get(1).blocked = 0;
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        // 高助攻玩家 O=1100 vs 纯伤害玩家 O=1100 接近 → 换血分不应明显更低
        final double assistPlayer = r.byAccount(1001).exchangeScore();
        final double damagePlayer = r.byAccount(1002).exchangeScore();
        assertTrue(Math.abs(assistPlayer - damagePlayer) < 30,
                "高助攻应等效计入有效输出，实际 " + assistPlayer + " vs " + damagePlayer);
    }

    // ---- 射击效率 ----

    @Test
    void shootingOneForOneIsNotNearMax() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 2000;
        specs.get(0).shots = 1;
        specs.get(0).hits = 1;
        specs.get(0).pens = 1;
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertTrue(r.byAccount(1001).shootingScore() < PlayerLeagueRating.MAX_SHOOTING * 0.5,
                "一发一中一穿不得接近满分，实际 " + r.byAccount(1001).shootingScore());
    }

    @Test
    void shootingHighEfficiencyNeedsDamageParticipation() {
        // 高效率但零伤害参与 → 射击分趋近 0
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 0;
        specs.get(0).shots = 50;
        specs.get(0).hits = 50;
        specs.get(0).pens = 50;
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertEquals(0, r.byAccount(1001).shootingScore(), 1e-9);
    }

    @Test
    void shootingConsistentHighEfficiencyScoresHigh() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 3000;
        specs.get(0).shots = 30;
        specs.get(0).hits = 30;
        specs.get(0).pens = 30;
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        // 30/30 命中击穿 + 高伤害参与 → 射击分接近满分
        assertTrue(r.byAccount(1001).shootingScore() > PlayerLeagueRating.MAX_SHOOTING * 0.8,
                "多次高效射击应接近满分，实际 " + r.byAccount(1001).shootingScore());
    }

    // ---- 存活 / 互换 ----

    @Test
    void deadWithTradeGetsSeventyFive() {
        // 让 1001 阵亡，且其死亡 ±5s 内有敌方阵亡 → TRADE
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).dead(100.0);
        specs.get(7).dead(101.0);   // 敌方死亡在 ±5s 窗口内
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final PlayerLeagueRating p = r.byAccount(1001);
        assertEquals(75, p.survivalTradeScore(), 1e-9);
        assertEquals(LeagueRatingCalculator.STATE_TRADE, p.survivalState());
    }

    @Test
    void loserSurvivedTopFourGetsFifty() {
        // 队2 全存活（败方），仅前四各 +50（同分按稳定排序选出）
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        long top4 = r.players().stream()
                .filter(p -> p.team() == 2 && p.survivalTradeScore() == 50
                        && LeagueRatingCalculator.STATE_LOSER_TOP4.equals(p.survivalState()))
                .count();
        assertEquals(4, top4);
    }

    @Test
    void loserSurvivedBeyondTopFourGetsZero() {
        // 队2 7 人全存活且全部同分 → 前四由 accountId 稳定选出，其余 3 人 0
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        long top4 = r.players().stream()
                .filter(p -> p.team() == 2 && p.survivalTradeScore() == 50).count();
        assertEquals(4, top4);
        long zero = r.players().stream()
                .filter(p -> p.team() == 2 && p.survivalTradeScore() == 0).count();
        assertEquals(3, zero);
    }

    @Test
    void deadNoTradeNoSurvivalScore() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).dead(100.0);
        // 无敌方在 ±5s 内死亡
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertEquals(0, r.byAccount(1001).survivalTradeScore(), 1e-9);
    }

    // ---- 最终分 ----

    @Test
    void winnerMultiplierCapsAtOneThousand() {
        // 打造碾压胜方玩家：全维度满分附近 → base×1.05 > 1000 → 封顶 1000
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage(20000).assist(5000).blocked(5000).kills(14)
                .shots(100).hits(100).pens(100).points(1000, 1000).received(100);
        specs.get(0).survived = true;
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertEquals(1000, r.byAccount(1001).finalRating(), 1e-9);
    }

    @Test
    void loserNeverPenalized() {
        // 败方玩家的 finalRating 至少等于 baseRating（不扣分）
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        for (final PlayerLeagueRating p : r.players()) {
            if (p.team() == 2) {
                assertEquals(p.baseRating(), p.finalRating(), 1e-9);
            }
        }
    }

    // ---- MVP / 队内最佳 ----

    @Test
    void mvpIsHighestFinalRatingPlayer() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage(20000).kills(10);   // 胜方碾压
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertEquals(1001, r.mvp().accountId());
        assertTrue(r.mvp().mvp());
    }

    @Test
    void mvpComparatorPrefersWinnerOnEqualScore() {
        // 同 finalRating：胜方优先（比较器直接测试）
        final PlayerLeagueRating loser = new PlayerLeagueRating(
                2001, "L", "", 2, 0, 0, 0, 0, 0, 0, 0,
                0, 100, 100, LeagueRatingCalculator.STATE_TRADE,
                500, 0, 1, false, false, false);
        final PlayerLeagueRating winner = new PlayerLeagueRating(
                1001, "W", "", 1, 0, 0, 0, 0, 0, 0, 0,
                0, 95, 100, LeagueRatingCalculator.STATE_WIN_SURVIVED,
                300, 0, 1, true, false, false);
        final var cmp = LeagueRatingCalculator.mvpComparator(1);
        assertTrue(cmp.compare(loser, winner) < 0, "胜方应优先");
    }

    @Test
    void mvpComparatorBreaksTieByDamage() {
        final PlayerLeagueRating a = new PlayerLeagueRating(
                1001, "A", "", 1, 0, 0, 0, 0, 0, 0, 0,
                0, 100, 105, LeagueRatingCalculator.STATE_WIN_SURVIVED,
                800, 0, 1, true, false, false);
        final PlayerLeagueRating b = new PlayerLeagueRating(
                1002, "B", "", 1, 0, 0, 0, 0, 0, 0, 0,
                0, 100, 105, LeagueRatingCalculator.STATE_WIN_SURVIVED,
                900, 0, 1, true, false, false);
        final var cmp = LeagueRatingCalculator.mvpComparator(1);
        assertTrue(cmp.compare(a, b) < 0, "伤害更高者优先");
    }

    @Test
    void teamBestPerTeamAndSamePlayerCanBeBoth() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage(20000).kills(10);   // 队1 最佳 + 全场 MVP
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final PlayerLeagueRating mvp = r.mvp();
        assertTrue(mvp.teamBest(), "MVP 同时是队内最佳");
        assertEquals(1, r.team1().teamBest().accountId() == 1001 ? 1 : 0);
        assertEquals(1001, r.team1().teamBest().accountId());
        // 队2 队内最佳非 MVP
        final PlayerLeagueRating t2best = r.team2().teamBest();
        assertTrue(!t2best.mvp());
        assertEquals(2, t2best.team());
    }

    // ---- 战队 Rating ----

    @Test
    void teamRatingIsAverageOfSevenFinalRatings() {
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        final double expected = r.team1().players().stream()
                .mapToDouble(PlayerLeagueRating::finalRating).average().orElseThrow();
        assertEquals(expected, r.team1().teamRating(), 1e-9);
        assertEquals(7, r.team1().players().size());
        assertEquals(7, r.team2().players().size());
    }

    // ---- 七维回归（plan §20）----

    /** 七维满分总和必须保持 1000（Objective 50 删除后 Shooting 50→100 补位）。 */
    @Test
    void sevenDimensionMaxesSumToThousand() {
        final double total = PlayerLeagueRating.MAX_DAMAGE + PlayerLeagueRating.MAX_ASSIST
                + PlayerLeagueRating.MAX_KILL + PlayerLeagueRating.MAX_EXCHANGE
                + PlayerLeagueRating.MAX_BLOCKED + PlayerLeagueRating.MAX_SURVIVAL_TRADE
                + PlayerLeagueRating.MAX_SHOOTING;
        assertEquals(1000, total, 1e-9);
        assertEquals(100, PlayerLeagueRating.MAX_SHOOTING, 1e-9);
        assertEquals(7, LeagueColumns.DIM_KEYS.size(), "Rating 必须只有七维");
        assertEquals(7, LeagueColumns.DIM_MAX.size(), "DIM_MAX 必须与 DIM_KEYS 对齐");
        for (int d = 0; d < LeagueColumns.DIM_KEYS.size(); d++) {
            assertEquals(LeagueColumns.dimMax(d), LeagueColumns.DIM_MAX.get(d), 1e-9);
            assertTrue(!LeagueColumns.DIM_KEYS.get(d).contains("objective"),
                    "不得残留 objective 维度 key");
        }
    }

    /** victoryPointsEarned / victoryPointsSeized 是客观事实，不得影响任何 Rating（plan §4.5）。 */
    @Test
    void victoryPointsDoNotAffectRating() {
        final List<LeagueTestBattles.PlayerSpec> base = defaultSevenVsSeven();
        final List<LeagueTestBattles.PlayerSpec> changed = new ArrayList<>();
        for (final LeagueTestBattles.PlayerSpec s : base) {
            changed.add(new LeagueTestBattles.PlayerSpec(s.accountId, s.team)
                    .damage(s.damage).assist(s.assist).blocked(s.blocked).kills(s.kills)
                    .shots(s.shots).hits(s.hits).pens(s.pens).received(s.received)
                    .points(s.earned, s.seized).clan(s.clan));
        }
        for (final LeagueTestBattles.PlayerSpec s : changed) {
            // 只改争霸点数（覆盖全部增量组合），其它 battle facts 完全不变
            s.points(s.earned + 137, s.seized + 89);
        }
        final LeagueRatingResult r0 = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, base));
        final LeagueRatingResult r1 = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, changed));
        for (int i = 0; i < r0.players().size(); i++) {
            final PlayerLeagueRating a = r0.players().get(i);
            final PlayerLeagueRating b = r1.players().get(i);
            assertEquals(a.damageScore(), b.damageScore(), 1e-9, "damage 不得受占点影响");
            assertEquals(a.assistScore(), b.assistScore(), 1e-9, "assist 不得受占点影响");
            assertEquals(a.killScore(), b.killScore(), 1e-9, "kill 不得受占点影响");
            assertEquals(a.exchangeScore(), b.exchangeScore(), 1e-9, "exchange 不得受占点影响");
            assertEquals(a.blockedScore(), b.blockedScore(), 1e-9, "blocked 不得受占点影响");
            assertEquals(a.survivalTradeScore(), b.survivalTradeScore(), 1e-9, "survival 不得受占点影响");
            assertEquals(a.shootingScore(), b.shootingScore(), 1e-9, "shooting 不得受占点影响");
            assertEquals(a.finalRating(), b.finalRating(), 1e-9, "final Rating 不得受占点影响");
            assertEquals(a.team(), b.team());
        }
        assertEquals(r0.team1().teamRating(), r1.team1().teamRating(), 1e-9, "Team Rating 不得受占点影响");
        assertEquals(r0.team2().teamRating(), r1.team2().teamRating(), 1e-9, "Team Rating 不得受占点影响");
        assertEquals(r0.mvp().accountId(), r1.mvp().accountId(), "MVP 不得受占点影响");
        assertEquals(r0.team1().teamBest().accountId(), r1.team1().teamBest().accountId(), "队内最佳不得受占点影响");
        assertEquals(r0.team2().teamBest().accountId(), r1.team2().teamBest().accountId(), "队内最佳不得受占点影响");
    }

    /** 七维均在 [0, dimensionMax]，最终 Rating 在 [0, 1000]（plan §20 Boundary）。 */
    @Test
    void sevenDimensionsStayWithinBounds() {
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, true));
        for (final PlayerLeagueRating p : r.players()) {
            assertTrue(0 <= p.damageScore() && p.damageScore() <= PlayerLeagueRating.MAX_DAMAGE);
            assertTrue(0 <= p.assistScore() && p.assistScore() <= PlayerLeagueRating.MAX_ASSIST);
            assertTrue(0 <= p.killScore() && p.killScore() <= PlayerLeagueRating.MAX_KILL);
            assertTrue(0 <= p.exchangeScore() && p.exchangeScore() <= PlayerLeagueRating.MAX_EXCHANGE);
            assertTrue(0 <= p.blockedScore() && p.blockedScore() <= PlayerLeagueRating.MAX_BLOCKED);
            assertTrue(0 <= p.survivalTradeScore() && p.survivalTradeScore() <= PlayerLeagueRating.MAX_SURVIVAL_TRADE);
            assertTrue(0 <= p.shootingScore() && p.shootingScore() <= PlayerLeagueRating.MAX_SHOOTING);
            assertTrue(0 <= p.finalRating() && p.finalRating() <= PlayerLeagueRating.MAX_FINAL);
        }
    }
}
