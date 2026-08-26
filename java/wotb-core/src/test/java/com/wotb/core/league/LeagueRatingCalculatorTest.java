package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static com.wotb.core.league.LeagueTestBattles.defaultSevenVsSeven;

/** League Rating 七维度公式 / 存活 / 最终分 / MVP。 */
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
        // T=0.5、G=0.5 → damage=365×0.5=182.5 / assist=55 / kill=55 / blocked=25 / exchange=90
        assertEquals(182.5, p.damageScore(), 1e-6);
        assertEquals(55, p.assistScore(), 1e-6);
        assertEquals(55, p.killScore(), 1e-6);
        assertEquals(25, p.blockedScore(), 1e-6);
        assertEquals(90, p.exchangeScore(), 1e-6);
        // 射击 V4.1：Soft Wilson（90% Wilson 下界 + 10% raw）× 伤害参与=1，
        // conf=0.3×softAcc+0.7×softPen
        final double softAcc = 0.90 * LeagueRatingNormalizer.wilsonLowerBound(8, 10)
                + 0.10 * LeagueRatingCalculator.rawRate(8, 10);
        final double softPen = 0.90 * LeagueRatingNormalizer.wilsonLowerBound(6, 8)
                + 0.10 * LeagueRatingCalculator.rawRate(6, 8);
        final double conf = 0.3 * softAcc + 0.7 * softPen;
        assertEquals(110 * Math.min(1, conf / 0.70), p.shootingScore(), 1e-6);
        // 全部维度在 [0, max]
        assertTrue(p.damageScore() <= PlayerLeagueRating.MAX_DAMAGE);
        assertTrue(p.shootingScore() <= PlayerLeagueRating.MAX_SHOOTING);
    }

    @Test
    void dimensionScoresAlignWithCanonicalDimensionKeys() {
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        final PlayerLeagueRating p = r.byAccount(1001);
        final List<Double> scores = p.dimensionScores();
        // 唯一有序表示：数量与顺序必须 == canonical DIM_KEYS（维度增删时任一 consumer 不得静默漏一维）
        assertEquals(LeagueColumns.DIM_KEYS.size(), scores.size(),
                "dimensionScores 数量必须 == LeagueColumns.DIM_KEYS.size()");
        for (int d = 0; d < LeagueColumns.DIM_KEYS.size(); d++) {
            final String key = LeagueColumns.dimKey(d);
            final double expected = switch (key) {
                case "league_damage_score" -> p.damageScore();
                case "league_assist_score" -> p.assistScore();
                case "league_kill_score" -> p.killScore();
                case "league_exchange_score" -> p.exchangeScore();
                case "league_blocked_score" -> p.blockedScore();
                case "league_survival_score" -> p.survivalTradeScore();
                case "league_shooting_score" -> p.shootingScore();
                default -> throw new AssertionError("unexpected dimension key: " + key);
            };
            assertEquals(expected, scores.get(d), 1e-9,
                    "dimensionScores[" + d + "] 必须 == " + key);
        }
    }

    @Test
    void winnerSurvivedGetsSeventyFiveAndMultiplier() {
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(identicalBattle(1, false));
        final PlayerLeagueRating winner = r.byAccount(1001);
        final PlayerLeagueRating loser = r.byAccount(2001);
        assertEquals(LeagueRatingCalculator.STATE_WIN_SURVIVED, winner.survivalState());
        assertEquals(75, winner.survivalTradeScore(), 1e-9);
        // 胜方 ×1.05：base = prelim + 75 → final = base × 1.05（未到 1000 封顶）
        final double expectedWinner = (winner.preliminary() + 75) * 1.05;
        assertEquals(expectedWinner, winner.finalRating(), 1e-9);
        // 败方存活 V4.1：LOSER_TOP4 已删除，RC 恒 0、state=NONE，无倍率
        assertEquals(0, loser.survivalTradeScore(), 1e-9);
        assertEquals(LeagueRatingCalculator.STATE_NONE, loser.survivalState());
        assertEquals(loser.preliminary(), loser.finalRating(), 1e-9);
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
        // 全员存活 → 胜方 RC 75、败方 RC 0；其余六维全 0
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

    // ---- Soft Wilson 精确公式与机械偏差回归（V4.1 核心）----

    @Test
    void softWilsonExactFormula() {
        // 固定样本 shots=8 / hits=7 / pens=6，高伤害参与（DP=1）：
        // softAcc = 0.9×wilson(7,8) + 0.1×raw(7/8)
        // softPen = 0.9×wilson(6,7) + 0.1×raw(6/7)
        // conf = 0.3×softAcc + 0.7×softPen；score = 110×min(1, conf/0.7)×DP
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 20000; // DP=1
        specs.get(0).shots = 8;
        specs.get(0).hits = 7;
        specs.get(0).pens = 6;
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final double softAcc = 0.90 * LeagueRatingNormalizer.wilsonLowerBound(7, 8)
                + 0.10 * LeagueRatingCalculator.rawRate(7, 8);
        final double softPen = 0.90 * LeagueRatingNormalizer.wilsonLowerBound(6, 7)
                + 0.10 * LeagueRatingCalculator.rawRate(6, 7);
        final double conf = 0.30 * softAcc + 0.70 * softPen;
        final double expected = PlayerLeagueRating.MAX_SHOOTING * Math.min(1.0, conf / 0.70);
        assertEquals(expected, r.byAccount(1001).shootingScore(), 1e-9,
                "Shooting 必须精确按 Soft Wilson 公式计算（0.9 Wilson + 0.1 raw，30/70 合成）");
    }

    @Test
    void softWilsonMechanicalBiasGapSmallerThanPureWilson() {
        // 低样本 8/7/7 vs 高样本 16/14/14：raw accuracy / raw penetration / DP 全部相同，
        // 纯 Wilson 的机械偏差被 Soft Wilson 收敛（softGap < pureWilsonGap），
        // 但小样本仍保持保守（lowShotSoft <= highShotSoft）。
        final List<LeagueTestBattles.PlayerSpec> low = defaultSevenVsSeven();
        low.get(0).damage = 20000;
        low.get(0).shots = 8;
        low.get(0).hits = 7;
        low.get(0).pens = 7;
        final List<LeagueTestBattles.PlayerSpec> high = defaultSevenVsSeven();
        high.get(0).damage = 20000;
        high.get(0).shots = 16;
        high.get(0).hits = 14;
        high.get(0).pens = 14;
        final double lowSoft = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, low))
                .byAccount(1001).shootingScore();
        final double highSoft = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, high))
                .byAccount(1001).shootingScore();

        final double lowPureConf = 0.30 * LeagueRatingNormalizer.wilsonLowerBound(7, 8)
                + 0.70 * LeagueRatingNormalizer.wilsonLowerBound(7, 7);
        final double highPureConf = 0.30 * LeagueRatingNormalizer.wilsonLowerBound(14, 16)
                + 0.70 * LeagueRatingNormalizer.wilsonLowerBound(14, 14);
        final double lowSoftConf = 0.30 * (0.90 * LeagueRatingNormalizer.wilsonLowerBound(7, 8)
                + 0.10 * LeagueRatingCalculator.rawRate(7, 8))
                + 0.70 * (0.90 * LeagueRatingNormalizer.wilsonLowerBound(7, 7)
                + 0.10 * LeagueRatingCalculator.rawRate(7, 7));
        final double highSoftConf = 0.30 * (0.90 * LeagueRatingNormalizer.wilsonLowerBound(14, 16)
                + 0.10 * LeagueRatingCalculator.rawRate(14, 16))
                + 0.70 * (0.90 * LeagueRatingNormalizer.wilsonLowerBound(14, 14)
                + 0.10 * LeagueRatingCalculator.rawRate(14, 14));

        assertTrue((highSoftConf - lowSoftConf) < (highPureConf - lowPureConf),
                "Soft Wilson 必须缩小低/高样本的机械偏差：softGap="
                        + (highSoftConf - lowSoftConf) + " pureGap=" + (highPureConf - lowPureConf));
        assertTrue(lowSoft <= highSoft + 1e-9,
                "小样本仍应保持保守：lowShotSoft=" + lowSoft + " highShotSoft=" + highSoft);
    }

    // ---- Adversarial 哲学回归（plan §62：只锁排序关系，不锁具体分数）----

    @Test
    void highDamageZeroKillLoserCanOutscoreOrdinaryWinnerAndBeTeamTop() {
        // §62.1/62.2：败方高伤 0 kill 的 carry 玩家应高于普通胜方玩家，并成为本队最佳。
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        for (int i = 0; i < 7; i++) {
            specs.get(i).damage = 600; // 胜方本队平均输出（普通档位）
        }
        // 败方 2001：全场最高伤害 + 高助攻/阻挡/射击效率，但 0 kill、存活
        specs.get(7).damage(20000).assist(5000).blocked(5000)
                .shots(100).hits(100).pens(100).received(100);
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final PlayerLeagueRating loser = r.byAccount(2001);
        assertEquals(0, loser.kills(), "构造前提：0 kill");
        final double winnerMax = r.players().stream()
                .filter(p -> p.team() == 1)
                .mapToDouble(PlayerLeagueRating::finalRating)
                .max().orElseThrow();
        assertTrue(loser.finalRating() > winnerMax,
                "败方高伤 0 kill 应高于普通胜方玩家（只锁排序关系）");
        assertEquals(2001L, r.team2().teamBest().accountId(),
                "高伤 0 kill 玩家应能成为本队最佳");
    }

    @Test
    void lowDamageTradeDoesNotPushPlayerIntoTopThree() {
        // §62.6：RC=50 不能把明显低贡献玩家推成本队 Top3。
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).damage = 5;
        specs.get(0).assist = 0;
        specs.get(0).blocked = 0;
        specs.get(0).kills = 0;
        specs.get(0).shots = 0;
        specs.get(0).hits = 0;
        specs.get(0).pens = 0;
        specs.get(0).dead(100.0);
        specs.get(7).dead(101.0); // 有效 trade → RC 50
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final PlayerLeagueRating p = r.byAccount(1001);
        assertEquals(LeagueRatingCalculator.STATE_TRADE, p.survivalState());
        assertEquals(50, p.survivalTradeScore(), 1e-9);
        final List<PlayerLeagueRating> team1Sorted = r.players().stream()
                .filter(q -> q.team() == 1)
                .sorted(Comparator.comparingDouble(PlayerLeagueRating::finalRating).reversed())
                .toList();
        final int rank = team1Sorted.indexOf(p);
        assertTrue(rank >= 3, "低贡献 + RC=50 不得进入本队 Top3，实际 rank=" + rank);
    }

    // ---- 存活 / 互换 ----

    @Test
    void deadWithTradeGetsFifty() {
        // 让 1001 阵亡，且其死亡后 0..+5s 内有敌方阵亡 → TRADE
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).dead(100.0);
        specs.get(7).dead(101.0);   // 敌方死亡在 [0,+5s] 窗口内
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final PlayerLeagueRating p = r.byAccount(1001);
        assertEquals(50, p.survivalTradeScore(), 1e-9);
        assertEquals(LeagueRatingCalculator.STATE_TRADE, p.survivalState());
    }

    @Test
    void loserSurvivedAlwaysZeroRegardlessOfStanding() {
        // V4.1 业务锁：败方存活（即使 Damage 全场第一）RC 恒 0、state=NONE，
        // 永久防止 LOSER_TOP4 回归。
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(7).damage(20000); // 败方 Damage 全场最高
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final PlayerLeagueRating loser = r.byAccount(2001);
        assertEquals(0, loser.survivalTradeScore(), 1e-9, "败方存活 RC 必须 0");
        assertEquals(LeagueRatingCalculator.STATE_NONE, loser.survivalState(), "败方存活 state 必须 NONE");

        // 整队唯一幸存者同样拿 0（LOSER_TOP4 时代会因 top4 给分）
        final List<LeagueTestBattles.PlayerSpec> onlySurvivor = defaultSevenVsSeven();
        for (int i = 8; i < 14; i++) {
            onlySurvivor.get(i).dead(50.0 + i);
        }
        onlySurvivor.get(7).survived = true;
        onlySurvivor.get(7).damage(20000);
        final LeagueRatingResult r2 = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, onlySurvivor));
        assertEquals(0, r2.byAccount(2001).survivalTradeScore(), 1e-9);
        assertEquals(LeagueRatingCalculator.STATE_NONE, r2.byAccount(2001).survivalState());
    }

    @Test
    void deadNoTradeNoSurvivalScore() {
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).dead(100.0);
        // 无敌方在死亡后 0..+5s 内死亡
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertEquals(0, r.byAccount(1001).survivalTradeScore(), 1e-9);
    }

    @Test
    void unknownDeathTimeStillRatedWithNoneSurvivalState() {
        // dead + survivalTimeSec == 0（UNKNOWN）：Rating 照常生成；
        // 存活/互换维度 fail-closed 0（state=NONE），其它六维按真实 facts 正常计算，
        // 总分保持 0–1000 不重新归一化。
        final List<LeagueTestBattles.PlayerSpec> specs = defaultSevenVsSeven();
        specs.get(0).dead(0);
        final LeagueRatingResult r = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        final PlayerLeagueRating p = r.byAccount(1001);
        assertEquals(LeagueRatingCalculator.STATE_NONE, p.survivalState());
        assertEquals(0, p.survivalTradeScore(), 1e-9);
        assertTrue(p.damageScore() > 0, "其它六维按真实 facts 正常计算");
        assertTrue(p.assistScore() > 0);
        assertTrue(p.finalRating() <= PlayerLeagueRating.MAX_FINAL,
                "总分保持 0–1000，UNKNOWN 不得触发重新归一化");
        assertEquals(1000, PlayerLeagueRating.MAX_DAMAGE + PlayerLeagueRating.MAX_ASSIST
                + PlayerLeagueRating.MAX_KILL + PlayerLeagueRating.MAX_EXCHANGE
                + PlayerLeagueRating.MAX_BLOCKED + PlayerLeagueRating.MAX_SURVIVAL_TRADE
                + PlayerLeagueRating.MAX_SHOOTING, 1e-9);

        // UNKNOWN 死亡时刻不得建立 trade 窗口（即使敌方在相邻时刻阵亡）
        specs.get(7).dead(1.0);
        final LeagueRatingResult r2 = LeagueRatingCalculator.calculate(LeagueTestBattles.battle(1, specs));
        assertEquals(0, r2.byAccount(1001).survivalTradeScore(), 1e-9,
                "UNKNOWN 死亡时间不得推断 trade");
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

    // ---- 七维回归 ----

    /** V4.1 七维满分必须精确为 365/110/110/180/50/75/110，总和 1000（防未来单独改一维忘记总分）。 */
    @Test
    void sevenDimensionMaxesSumToThousand() {
        assertEquals(365, PlayerLeagueRating.MAX_DAMAGE, 1e-9);
        assertEquals(110, PlayerLeagueRating.MAX_ASSIST, 1e-9);
        assertEquals(110, PlayerLeagueRating.MAX_KILL, 1e-9);
        assertEquals(180, PlayerLeagueRating.MAX_EXCHANGE, 1e-9);
        assertEquals(50, PlayerLeagueRating.MAX_BLOCKED, 1e-9);
        assertEquals(75, PlayerLeagueRating.MAX_SURVIVAL_TRADE, 1e-9);
        assertEquals(110, PlayerLeagueRating.MAX_SHOOTING, 1e-9);
        final double total = PlayerLeagueRating.MAX_DAMAGE + PlayerLeagueRating.MAX_ASSIST
                + PlayerLeagueRating.MAX_KILL + PlayerLeagueRating.MAX_EXCHANGE
                + PlayerLeagueRating.MAX_BLOCKED + PlayerLeagueRating.MAX_SURVIVAL_TRADE
                + PlayerLeagueRating.MAX_SHOOTING;
        assertEquals(1000, total, 1e-9);
        assertEquals(7, LeagueColumns.DIM_KEYS.size(), "Rating 必须只有七维");
        assertEquals(7, LeagueColumns.DIM_MAX.size(), "DIM_MAX 必须与 DIM_KEYS 对齐");
        for (int d = 0; d < LeagueColumns.DIM_KEYS.size(); d++) {
            assertEquals(LeagueColumns.dimMax(d), LeagueColumns.DIM_MAX.get(d), 1e-9);
            assertTrue(!LeagueColumns.DIM_KEYS.get(d).contains("objective"),
                    "不得残留 objective 维度 key");
        }
    }

    /** victoryPointsEarned / victoryPointsSeized 是客观事实，不得影响任何 Rating。 */
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

    /** 七维均在 [0, dimensionMax]，最终 Rating 在 [0, 1000]（边界）。 */
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
