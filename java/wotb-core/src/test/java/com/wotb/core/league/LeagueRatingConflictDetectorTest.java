package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 同 arenaId 多份回放关键事实一致性 + source-aware 死亡时间收口。 */
class LeagueRatingConflictDetectorTest {

    private static Battle battle() {
        return LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
    }

    /** 把 player 设为阵亡并携带 canonical source（LIVE_EXACT / SETTLEMENT_SECOND / UNKNOWN）。 */
    private static void dead(final PlayerResult p, final double timeSec, final DeathTimeSource source) {
        p.survived = false;
        if (source == DeathTimeSource.LIVE_EXACT) {
            p.deathTimeSource = DeathTimeSource.LIVE_EXACT;
            p.survivalTimeSec = timeSec;
            p.deathTimeMillis = Math.round(timeSec * 1000.0);
        } else if (source == DeathTimeSource.SETTLEMENT_SECOND) {
            p.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
            p.deathTimeMillis = Math.round(timeSec * 1000.0);
            p.survivalTimeSec = timeSec;
        } else {
            p.deathTimeSource = DeathTimeSource.UNKNOWN;
            p.survivalTimeSec = 0;
            p.deathTimeMillis = 0;
        }
    }

    @Test
    void identicalCopiesAreConsistent() {
        assertTrue(LeagueRatingConflictDetector.consistent(battle(), battle()));
    }

    @Test
    void sameArenaDifferentWinnerConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.winnerTeam = 2;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void differentRosterConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.players.get(0).tankId = 9999;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void differentKeyStatsConflict() {
        final Battle a = battle();
        final Battle b = battle();
        b.players.get(3).damageDealt += 500;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void differentSurvivalStatusConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        dead(b.players.get(1), 100, DeathTimeSource.SETTLEMENT_SECOND);
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void deathTimeToleranceAllowsSmallDrift() {
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(2), 100.0, DeathTimeSource.SETTLEMENT_SECOND);
        dead(b.players.get(2), 100.5, DeathTimeSource.SETTLEMENT_SECOND);
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void differentBattleTypeConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.arenaBonusType = LeagueRatingMode.ARENA_BONUS_TYPE_TOURNAMENT;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    // ---- 死亡时间 UNKNOWN = 证据缺失，不是冲突 ----

    @Test
    void unknownVsUnknownDeathTimeIsConsistent() {
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(0), 0, DeathTimeSource.UNKNOWN);
        dead(b.players.get(0), 0, DeathTimeSource.UNKNOWN);
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void unknownVsKnownDeathTimeIsConsistent() {
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(0), 0, DeathTimeSource.UNKNOWN);
        dead(b.players.get(0), 128.12, DeathTimeSource.SETTLEMENT_SECOND);
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
        assertTrue(LeagueRatingConflictDetector.consistent(b, a),
                "KNOWN + UNKNOWN 必须与 UNKNOWN + KNOWN 一致（对称）");
    }

    @Test
    void knownVsKnownWithinToleranceIsConsistent() {
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(0), 128.12, DeathTimeSource.SETTLEMENT_SECOND);
        dead(b.players.get(0), 128.50, DeathTimeSource.SETTLEMENT_SECOND);
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void knownVsKnownBeyondToleranceConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(0), 100.0, DeathTimeSource.SETTLEMENT_SECOND);
        dead(b.players.get(0), 128.0, DeathTimeSource.SETTLEMENT_SECOND);
        assertFalse(LeagueRatingConflictDetector.consistent(a, b),
                "两个互相矛盾的 KNOWN 死亡时间超过容差 → 冲突");
    }

    @Test
    void liveExactVsSettlementBeyondToleranceConflicts() {
        // LIVE_EXACT 与 settlement 明显矛盾（差 > 容差）→ fail-closed conflict，
        // 不允许悄悄 Math.min 抹平两个来源。
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(0), 128.50, DeathTimeSource.LIVE_EXACT);
        dead(b.players.get(0), 100.0, DeathTimeSource.SETTLEMENT_SECOND);
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void unknownResidualNeverBecomesKnown() {
        // A：UNKNOWN source 但 survivalTimeSec residual=100 → 仍 UNKNOWN（residual 不得升级成 KNOWN）。
        final Battle a = battle();
        final PlayerResult pa = a.players.get(0);
        pa.survived = false;
        pa.deathTimeSource = DeathTimeSource.UNKNOWN;
        pa.survivalTimeSec = 100.0; // residual legacy 数字
        pa.deathTimeMillis = 100_000L;
        final Battle b = battle();
        dead(b.players.get(0), 0, DeathTimeSource.UNKNOWN);
        // 两者都是 UNKNOWN（residual 不代表 KNOWN）→ 兼容
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
        assertEquals(100.0, a.players.get(0).survivalTimeSec, 1e-9,
                "residual 不被改写（收口前）");
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        // 无任何 KNOWN canonical evidence → canonical 保持 UNKNOWN，绝不把 residual 100 变成 KNOWN
        assertEquals(DeathTimeSource.UNKNOWN, a.players.get(0).deathTimeSource,
                "全部 UNKNOWN → canonical 不得升级成 KNOWN");
        assertEquals(100.0, a.players.get(0).survivalTimeSec, 1e-9,
                "residual 不得被清洗（权威死亡时刻仍为 UNKNOWN）");
    }

    // ---- INVALID fail-closed ----（结构性负值/NaN 检查继续 fail-closed）

    @Test
    void invalidDeathTimeConflictsWithAnything() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = -1;
        dead(b.players.get(0), 128.0, DeathTimeSource.SETTLEMENT_SECOND);
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void unknownPlusNegativeConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(0), 0, DeathTimeSource.UNKNOWN);
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = -1;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void unknownPlusNaNConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        dead(a.players.get(0), 0, DeathTimeSource.UNKNOWN);
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = Double.NaN;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void survivorValidPlusNaNCConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = true;
        a.players.get(0).survivalTimeSec = 300;
        b.players.get(0).survived = true;
        b.players.get(0).survivalTimeSec = Double.NaN;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void twoValidSurvivorsDoNotUseDeathTimeTolerance() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = true;
        a.players.get(0).survivalTimeSec = 300;
        b.players.get(0).survived = true;
        b.players.get(0).survivalTimeSec = 301.5;
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
        assertTrue(LeagueRatingConflictDetector.consistent(b, a));
    }

    // ---- hard-conflict 字段 ----

    @Test
    void settlementCoverageMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.settlementAccountsCoveredByRoster = false;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void durationMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.durationS = 500.0;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void clanMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.players.get(0).clan = "XYZ";
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    // ---- group-level all-pairs ----

    @Test
    void groupUnknownSeparatedConflictingKnownsRejectedAllOrders() {
        final double[][] orders = {
                {0, 100, 128}, {0, 128, 100}, {100, 0, 128},
                {100, 128, 0}, {128, 0, 100}, {128, 100, 0}};
        for (final double[] o : orders) {
            final List<Battle> copies = java.util.Arrays.stream(o)
                    .mapToObj(t -> battleWithDeath(t)).toList();
            assertFalse(LeagueRatingConflictDetector.validateAndReconcile(copies),
                    "order " + java.util.Arrays.toString(o) + " 必须 conflict");
        }
    }

    @Test
    void groupUnknownWithConsistentKnownsAcceptedAllOrders() {
        final double[][] orders = {
                {0, 128.12, 128.50}, {0, 128.50, 128.12}, {128.12, 0, 128.50},
                {128.12, 128.50, 0}, {128.50, 0, 128.12}, {128.50, 128.12, 0}};
        for (final double[] o : orders) {
            final List<Battle> copies = java.util.Arrays.stream(o)
                    .mapToObj(t -> battleWithDeath(t)).toList();
            assertTrue(LeagueRatingConflictDetector.validateAndReconcile(copies),
                    "order " + java.util.Arrays.toString(o) + " 必须 not conflict");
            assertEquals(128.12, copies.getFirst().players.get(0).survivalTimeSec, 1e-9,
                    "canonical 必须是最小同-source KNOWN 128.12（与顺序无关）");
        }
    }

    @Test
    void reconcileNeverSanitizesInvalidToUnknown() {
        final Battle invalid = battle();
        invalid.players.get(0).survived = false;
        invalid.players.get(0).survivalTimeSec = -1;
        final Battle unknown = battle();
        dead(unknown.players.get(0), 0, DeathTimeSource.UNKNOWN);
        assertFalse(LeagueRatingConflictDetector.validateAndReconcile(List.of(invalid, unknown)));
        assertEquals(-1, invalid.players.get(0).survivalTimeSec, 1e-9);

        LeagueRatingConflictDetector.reconcileDeathTimes(invalid, List.of(invalid, unknown));
        assertEquals(-1, invalid.players.get(0).survivalTimeSec, 1e-9,
                "canonicalizer 不得清洗 INVALID");
    }

    private static Battle battleWithDeath(final double survivalTimeSec) {
        final Battle b = battle();
        dead(b.players.get(0), survivalTimeSec,
                survivalTimeSec > 0 ? DeathTimeSource.SETTLEMENT_SECOND : DeathTimeSource.UNKNOWN);
        return b;
    }

    // ---- source-aware canonical 死亡时间收口（P0-2） ----

    @Test
    void reconcileUnknownAndKnownUsesKnown() {
        final Battle unknown = battle();
        dead(unknown.players.get(0), 0, DeathTimeSource.UNKNOWN);
        final Battle known = battle();
        dead(known.players.get(0), 128.12, DeathTimeSource.SETTLEMENT_SECOND);
        LeagueRatingConflictDetector.reconcileDeathTimes(unknown, List.of(unknown, known));
        assertEquals(128.12, unknown.players.get(0).survivalTimeSec, 1e-9,
                "UNKNOWN + KNOWN → canonical 使用 KNOWN");
        assertEquals(DeathTimeSource.SETTLEMENT_SECOND, unknown.players.get(0).deathTimeSource);
        final Battle knownFirst = battle();
        dead(knownFirst.players.get(0), 128.12, DeathTimeSource.SETTLEMENT_SECOND);
        final Battle unknownSecond = battle();
        dead(unknownSecond.players.get(0), 0, DeathTimeSource.UNKNOWN);
        LeagueRatingConflictDetector.reconcileDeathTimes(knownFirst, List.of(knownFirst, unknownSecond));
        assertEquals(128.12, knownFirst.players.get(0).survivalTimeSec, 1e-9);
    }

    @Test
    void reconcileAllUnknownStaysUnknown() {
        final Battle a = battle();
        dead(a.players.get(0), 0, DeathTimeSource.UNKNOWN);
        final Battle b = battle();
        dead(b.players.get(0), 0, DeathTimeSource.UNKNOWN);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(0.0, a.players.get(0).survivalTimeSec, 1e-9);
        assertEquals(DeathTimeSource.UNKNOWN, a.players.get(0).deathTimeSource);
    }

    @Test
    void reconcileUnknownResidualNeverBecomesKnown() {
        // A 带 UNKNOWN source + residual survivalTimeSec=100；B 也是 UNKNOWN → canonical 保持 UNKNOWN。
        final Battle a = battle();
        final PlayerResult pa = a.players.get(0);
        pa.survived = false;
        pa.deathTimeSource = DeathTimeSource.UNKNOWN;
        pa.survivalTimeSec = 100.0;
        pa.deathTimeMillis = 100_000L;
        final Battle b = battle();
        dead(b.players.get(0), 0, DeathTimeSource.UNKNOWN);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(DeathTimeSource.UNKNOWN, a.players.get(0).deathTimeSource,
                "全部 UNKNOWN → canonical 不得升级成 KNOWN");
        assertEquals(100.0, a.players.get(0).survivalTimeSec, 1e-9,
                "residual 不得被清洗（纪律上该字段保留 legacy 值，权威死亡时刻仍为 UNKNOWN）");
    }

    @Test
    void reconcileUnknownResidualPlusSettlementUsesSettlement() {
        // A：UNKNOWN source + residual 100；B：SETTLEMENT_SECOND 128 → canonical = SETTLEMENT 128（不选 residual 100）。
        final Battle a = battle();
        final PlayerResult pa = a.players.get(0);
        pa.survived = false;
        pa.deathTimeSource = DeathTimeSource.UNKNOWN;
        pa.survivalTimeSec = 100.0;
        pa.deathTimeMillis = 100_000L;
        final Battle b = battle();
        dead(b.players.get(0), 128.0, DeathTimeSource.SETTLEMENT_SECOND);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.0, a.players.get(0).survivalTimeSec, 1e-9,
                "UNKNOWN + SETTLEMENT_SECOND → canonical 使用 SETTLEMENT_SECOND 128，不得选 residual 100");
        assertEquals(DeathTimeSource.SETTLEMENT_SECOND, a.players.get(0).deathTimeSource);
    }

    @Test
    void reconcileLiveExactWinsOverSettlementEvenWhenSmaller() {
        // LIVE_EXACT 128.50 优先于 SETTLEMENT_SECOND 128.00，即使 settlement 更小；两种顺序一致。
        final Battle a = battle();
        dead(a.players.get(0), 128.50, DeathTimeSource.LIVE_EXACT);
        final Battle b = battle();
        dead(b.players.get(0), 128.00, DeathTimeSource.SETTLEMENT_SECOND);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.50, a.players.get(0).survivalTimeSec, 1e-9,
                "LIVE_EXACT 必须优先，即使 settlement 数值更小");
        assertEquals(DeathTimeSource.LIVE_EXACT, a.players.get(0).deathTimeSource);

        // 顺序反转：以 settlement 副本为先（first），canonical 仍为 LIVE_EXACT 128.50。
        final Battle a2 = battle();
        dead(a2.players.get(0), 128.00, DeathTimeSource.SETTLEMENT_SECOND);
        final Battle b2 = battle();
        dead(b2.players.get(0), 128.50, DeathTimeSource.LIVE_EXACT);
        LeagueRatingConflictDetector.reconcileDeathTimes(a2, List.of(a2, b2));
        assertEquals(128.50, a2.players.get(0).survivalTimeSec, 1e-9,
                "顺序反转后 canonical 仍为 LIVE_EXACT 128.50");
        assertEquals(DeathTimeSource.LIVE_EXACT, a2.players.get(0).deathTimeSource);
    }

    @Test
    void reconcileUnknownPlusLiveExactUsesLiveExact() {
        final Battle a = battle();
        dead(a.players.get(0), 0, DeathTimeSource.UNKNOWN);
        final Battle b = battle();
        dead(b.players.get(0), 128.50, DeathTimeSource.LIVE_EXACT);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.50, a.players.get(0).survivalTimeSec, 1e-9);
        assertEquals(DeathTimeSource.LIVE_EXACT, a.players.get(0).deathTimeSource);
    }

    @Test
    void reconcileLiveExactKnownKnownUsesDeterministicMin() {
        // 两个 LIVE_EXACT 在容差内 → 确定性（min）+ 保留 source=LIVE_EXACT。
        final Battle a = battle();
        dead(a.players.get(0), 128.50, DeathTimeSource.LIVE_EXACT);
        final Battle b = battle();
        dead(b.players.get(0), 128.12, DeathTimeSource.LIVE_EXACT);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.12, a.players.get(0).survivalTimeSec, 1e-9,
                "两个 LIVE_EXACT 容差内 → 确定性 min");
        assertEquals(DeathTimeSource.LIVE_EXACT, a.players.get(0).deathTimeSource);
    }

    @Test
    void reconcileKnownKnownUsesDeterministicMin() {
        final Battle a = battle();
        dead(a.players.get(0), 128.50, DeathTimeSource.SETTLEMENT_SECOND);
        final Battle b = battle();
        dead(b.players.get(0), 128.12, DeathTimeSource.SETTLEMENT_SECOND);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.12, a.players.get(0).survivalTimeSec, 1e-9);
        final Battle c = battle();
        dead(c.players.get(0), 128.12, DeathTimeSource.SETTLEMENT_SECOND);
        final Battle d = battle();
        dead(d.players.get(0), 128.50, DeathTimeSource.SETTLEMENT_SECOND);
        LeagueRatingConflictDetector.reconcileDeathTimes(c, List.of(c, d));
        assertEquals(128.12, c.players.get(0).survivalTimeSec, 1e-9);
    }

    @Test
    void reconcileLeavesSurvivorsUntouched() {
        final Battle a = battle();
        final Battle b = battle();
        dead(b.players.get(0), 128.12, DeathTimeSource.SETTLEMENT_SECOND);
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(300.0, a.players.get(0).survivalTimeSec, 1e-9, "存活玩家不得被收口");
    }
}
