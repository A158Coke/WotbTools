package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PerformanceMetricsCalculatorTest {

    /** 测试默认用真实车辆（Kranvagn 4481，tankopedia base 2400），保证场均 HP 可判定。 */
    private static final long DEFAULT_TANK_ID = 4481L;

    @Test
    void kastUsesBestSingleBattleContribution() {
        // 完整 14 人（7+7），全部 HP known → 场均 HP complete
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, 1, 0, 0, 0, false, 100, 1000),   // 死 100s，窗口内有敌 103/104s 死亡
                player(2, 1, 0, 0, 0, true, 0, 0),
                player(3, 2, 0, 0, 0, false, 104, 1000),
                player(4, 2, 0, 0, 0, false, 103, 1000),
                player(5, 1, 0, 0, 0, true, 0, 0),
                player(6, 1, 0, 0, 0, true, 0, 0),
                player(7, 1, 0, 0, 0, true, 0, 0),
                player(8, 2, 0, 0, 0, true, 0, 0),
                player(9, 2, 0, 0, 0, true, 0, 0),
                player(10, 1, 0, 0, 0, true, 0, 0),
                player(11, 1, 0, 0, 0, true, 0, 0),
                player(12, 2, 0, 0, 0, true, 0, 0),
                player(13, 2, 0, 0, 0, true, 0, 0),
                player(14, 2, 0, 0, 0, true, 0, 0)
        );

        final List<PerformanceMetricsCalculator.Row> rows =
                PerformanceMetricsCalculator.compute(List.of(battle));
        final PerformanceMetricsCalculator.Row traded = row(rows, 1);

        assertEquals(100.0, traded.kast, 0.01);
    }

    @Test
    void metricsExposePotentialAssistImpactAndMultiDamageWithoutCompositeRating() {
        // 完整 14 人（7+7），全部 HP known → 场均 HP complete（不得用不完整 battle 冒充）
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, 1, 2600, 400, 2, true, 0, 0),   // carry
                player(2, 1, 100, 0, 0, true, 0, 0),        // low
                player(3, 1, 100, 0, 0, true, 0, 0),
                player(4, 1, 100, 0, 0, true, 0, 0),
                player(5, 1, 100, 0, 0, true, 0, 0),
                player(6, 1, 100, 0, 0, true, 0, 0),
                player(7, 1, 100, 0, 0, true, 0, 0),
                player(8, 2, 600, 0, 0, false, 120, 1000),
                player(9, 2, 200, 0, 0, true, 0, 0),
                player(10, 2, 200, 0, 0, true, 0, 0),
                player(11, 2, 200, 0, 0, true, 0, 0),
                player(12, 2, 200, 0, 0, true, 0, 0),
                player(13, 2, 200, 0, 0, true, 0, 0),
                player(14, 2, 200, 0, 0, true, 0, 0)
        );

        final List<PerformanceMetricsCalculator.Row> rows =
                PerformanceMetricsCalculator.compute(List.of(battle));
        final PerformanceMetricsCalculator.Row carry = row(rows, 1);
        final PerformanceMetricsCalculator.Row low = row(rows, 2);

        assertEquals(400.0, carry.assistAvg, 0.01);
        assertEquals(100.0, carry.kast, 0.1);
        assertTrue(carry.impact.endsWith("%"));
        assertEquals(100.0, carry.multiDamageRate, 0.01);
        assertTrue(carry.impactValue > low.impactValue);
        assertTrue(carry.contribution > low.contribution);
    }

    @Test
    void computeFallsBackToAccountIdWhenNicknameWhitespace() {
        final PlayerResult blankNicknamePlayer = player(1, 1, 2600, 400, 2, true, 0, 0);
        blankNicknamePlayer.nickname = "   ";
        final List<PlayerResult> players = new ArrayList<>();
        players.add(blankNicknamePlayer);
        for (int i = 2; i <= 14; i++) {
            players.add(player(i, i <= 7 ? 1 : 2, 100, 0, 0, true, 0, 0));
        }
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = players;

        final List<PerformanceMetricsCalculator.Row> rows =
                PerformanceMetricsCalculator.compute(List.of(battle));

        assertEquals("1", row(rows, 1).nickname);
    }

    @Test
    void averageHpUsesObservedEntryHpInBattleTotalDividedByFourteen() {
        final Tankopedia tankopedia = Tankopedia.load();
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 7; index++) {
            final PlayerResult teamOne = playerWithTank(index + 1L, 1, 4481L);
            if (index == 0) {
                teamOne.entryHpSource = EntryHpSource.OBSERVED_EXACT;
                teamOne.entryHp = 2600;
            }
            players.add(teamOne);
            players.add(playerWithTank(index + 8L, 2, 19217L));
        }
        final Battle battle = new Battle();
        battle.players = players;

        final double expected = (2600.0 + 6.0 * tankopedia.info(4481L).maxHp()
                + 7.0 * tankopedia.info(19217L).maxHp()) / 14.0;
        final List<PerformanceMetricsCalculator.Row> rows =
                PerformanceMetricsCalculator.compute(List.of(battle));

        assertEquals(expected, row(rows, 1L).averageHp, 0.01);
        assertEquals(expected, row(rows, 8L).averageHp, 0.01);
    }

    @Test
    void hpUnknownBattleFailsClosedDerivedMetricsButKeepsRawFacts() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, 1, 2600, 400, 2, true, 0, 0),
                player(2, 2, 600, 0, 0, false, 120, 1000)
        );
        for (final PlayerResult p : battle.players) {
            p.tankId = -1; // 无 tankopedia base、无 entryHp → HP UNKNOWN
        }

        final List<PerformanceMetricsCalculator.Row> rows =
                PerformanceMetricsCalculator.compute(List.of(battle));

        final PerformanceMetricsCalculator.Row carry = row(rows, 1);
        // 依赖 HP 的衍生指标 fail-closed（不产生伪精确结果）
        assertEquals(0.0, carry.averageHp, 0.01, "HP unknown 时场均 HP unavailable");
        assertEquals(0.0, carry.kast, 0.01, "HP unknown 时 KAST 不得伪精确");
        assertEquals(0.0, carry.contribution, 0.01, "HP unknown 时贡献度不得伪精确");
        assertEquals(0.0, carry.multiDamageRate, 0.01, "HP 未知时不得猜测多伤");
        // 不依赖 HP 的原始权威数据仍正常
        assertEquals(2600, carry.damage, "原始 damage 不受影响");
        assertEquals(2, carry.kills, "原始 kills 不受影响");
        assertEquals(1, carry.battles, "场次仍计入");
        assertTrue(carry.impactValue > 0, "Impact 不依赖 HP，仍正常计算");
    }

    @Test
    void mixedHpKnownAndUnknownBattlesDeriveMetricsOnlyFromKnown() {
        final Battle known = new Battle();
        known.winnerTeam = 1;
        final List<PlayerResult> knownPlayers = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            knownPlayers.add(player(i + 1L, i < 7 ? 1 : 2, 2600, 400, 2, true, 0, 0));
        }
        known.players = knownPlayers;

        final Battle unknown = new Battle();
        unknown.winnerTeam = 1;
        final List<PlayerResult> unknownPlayers = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = player(i + 1L, i < 7 ? 1 : 2, 1000, 200, 1, true, 0, 0);
            p.tankId = -1; // 该场全部 UNKNOWN → 场均 HP unavailable
            unknownPlayers.add(p);
        }
        unknown.players = unknownPlayers;

        final List<PerformanceMetricsCalculator.Row> rows =
                PerformanceMetricsCalculator.compute(List.of(known, unknown));

        final PerformanceMetricsCalculator.Row row = row(rows, 1L);
        // 原始权威数据跨两场累计
        assertEquals(2, row.battles);
        assertEquals(3600, row.damage, "damage 跨场累计（含 UNKNOWN 场）");
        assertEquals(3, row.kills, "kills 跨场累计（含 UNKNOWN 场）");
        // 衍生指标只按 HP 已知场次计算（分母=1 场），不得被 UNKNOWN 场稀释或伪造
        assertEquals(2400.0, row.averageHp, 0.01, "场均 HP 只来自 HP 已知场");
        assertEquals(100.0, row.kast, 0.01, "KAST 只按 HP 已知场判定");
        assertEquals(100.0, row.multiDamageRate, 0.01, "多伤率分母 = HP 已知场数");
        assertEquals(100.0 * 3685.714 / (7 * 3685.714), row.contribution, 0.1, "贡献度只按 HP 已知场计算");
        assertEquals(112.5, row.impactValue, 0.01, "Impact 不依赖 HP，两场均计入（known 场 kills=2 → 125；unknown 场 kills=1 → 100）");
    }

    @Test
    void battleMetricsMatchesAggregateForSingleBattle() {
        // 单场 battleMetrics 必须与 compute(List.of(battle)) 同一公式、同一值（计划 §19 单一事实源）
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(
                player(1, 1, 2600, 400, 2, true, 0, 0),
                player(2, 1, 100, 0, 0, true, 0, 0),
                player(3, 1, 100, 0, 0, true, 0, 0),
                player(4, 1, 100, 0, 0, true, 0, 0),
                player(5, 1, 100, 0, 0, true, 0, 0),
                player(6, 1, 100, 0, 0, true, 0, 0),
                player(7, 1, 100, 0, 0, true, 0, 0),
                player(8, 2, 600, 0, 0, false, 120, 1000),
                player(9, 2, 200, 0, 0, true, 0, 0),
                player(10, 2, 200, 0, 0, true, 0, 0),
                player(11, 2, 200, 0, 0, true, 0, 0),
                player(12, 2, 200, 0, 0, true, 0, 0),
                player(13, 2, 200, 0, 0, true, 0, 0),
                player(14, 2, 200, 0, 0, true, 0, 0)
        );

        final Map<Long, PerformanceMetricsCalculator.PlayerMetrics> battleMetrics =
                PerformanceMetricsCalculator.battleMetrics(battle);
        final PerformanceMetricsCalculator.Row aggregate = row(
                PerformanceMetricsCalculator.compute(List.of(battle)), 1);

        final PerformanceMetricsCalculator.PlayerMetrics m = battleMetrics.get(1L);
        assertNotNull(m, "battleMetrics 必须含账号 1");
        assertEquals(100.0, m.kast(), 0.01, "单场 KAST == 聚合单场 KAST");
        assertEquals(aggregate.kast, m.kast(), 0.01);
        assertEquals(aggregate.contribution, m.contribution(), 0.01);
        assertEquals(aggregate.impactValue, m.impact(), 0.01);
        // populateBattle 回填 PlayerResult，供 Columns.PLAYER 直接消费
        PerformanceMetricsCalculator.populateBattle(battle);
        final PlayerResult p1 = battle.players.stream().filter(p -> p.accountId == 1L).findFirst().orElseThrow();
        assertEquals(100.0, p1.kast, 0.01);
        assertEquals(aggregate.contribution, p1.contribution, 0.01);
        assertEquals(aggregate.impactValue, p1.impact, 0.01);
    }

    @Test
    void battleMetricsNullWhenHpUnknownButImpactComputed() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = List.of(player(1, 1, 2600, 400, 2, true, 0, 0));
        for (final PlayerResult p : battle.players) {
            p.tankId = -1; // HP UNKNOWN
        }

        final Map<Long, PerformanceMetricsCalculator.PlayerMetrics> metrics =
                PerformanceMetricsCalculator.battleMetrics(battle);

        final PerformanceMetricsCalculator.PlayerMetrics m = metrics.get(1L);
        assertNotNull(m);
        assertNull(m.contribution(), "HP UNKNOWN 时 contribution 必须 null（不冒充 0）");
        assertNull(m.kast(), "HP UNKNOWN 时 kast 必须 null（不冒充 0）");
        assertNotNull(m.impact(), "Impact 不依赖 HP，恒有值");
        assertTrue(m.impact() > 0);
    }

    @Test
    void battleMetricsKeyedByAccountIdUnaffectedByPlayerOrder() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            players.add(player(i + 1L, i < 7 ? 1 : 2, 2600 - i * 100, 400, 2, true, 0, 0));
        }
        battle.players = players;

        final Map<Long, PerformanceMetricsCalculator.PlayerMetrics> metrics =
                PerformanceMetricsCalculator.battleMetrics(battle);

        // 正序取值作为基准，逆序遍历仍能按 accountId 取到同一账号的同一值（不受排序/昵称影响）
        final double[] kastBaseline = new double[14];
        final double[] contributionBaseline = new double[14];
        final double[] impactBaseline = new double[14];
        for (int i = 0; i < 14; i++) {
            final PerformanceMetricsCalculator.PlayerMetrics m = metrics.get(i + 1L);
            assertNotNull(m, "accountId " + (i + 1) + " 必须存在");
            assertTrue(m.contribution() != null, "HP 已知场 contribution 不应为 null");
            kastBaseline[i] = m.kast();
            contributionBaseline[i] = m.contribution();
            impactBaseline[i] = m.impact();
        }
        for (int i = 13; i >= 0; i--) {
            final PerformanceMetricsCalculator.PlayerMetrics m = metrics.get(i + 1L);
            assertEquals(kastBaseline[i], m.kast(), 0.01);
            assertEquals(contributionBaseline[i], m.contribution(), 0.01);
            assertEquals(impactBaseline[i], m.impact(), 0.01);
        }
    }

    private static PerformanceMetricsCalculator.Row row(
            final List<PerformanceMetricsCalculator.Row> rows, final long accountId) {
        return rows.stream().filter(r -> r.accountId == accountId).findFirst().orElseThrow();
    }

    private static PlayerResult playerWithTank(final long accountId, final int team, final long tankId) {
        final PlayerResult player = player(accountId, team, 0, 0, 0, true, 0, 0);
        player.tankId = tankId;
        return player;
    }

    private static PlayerResult player(final long accountId, final int team, final int damage,
                                       final int assist, final int kills, final boolean survived,
                                       final double survivalTimeSec, final int damageReceived) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = "p" + accountId;
        player.team = team;
        player.tankId = DEFAULT_TANK_ID;
        player.damageDealt = damage;
        player.damageAssisted = assist;
        player.kills = kills;
        player.survived = survived;
        player.survivalTimeSec = survivalTimeSec;
        player.damageReceived = damageReceived;
        return player;
    }
}
