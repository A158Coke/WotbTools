package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 同 arenaId 多份回放关键事实一致性。 */
class LeagueRatingConflictDetectorTest {

    private static Battle battle() {
        return LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
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
        b.players.get(1).survived = false;
        b.players.get(1).survivalTimeSec = 100;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void deathTimeToleranceAllowsSmallDrift() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(2).survived = false;
        a.players.get(2).survivalTimeSec = 100.0;
        b.players.get(2).survived = false;
        b.players.get(2).survivalTimeSec = 100.5; // ≤1s 容忍
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void differentBattleTypeConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.arenaBonusType = LeagueRatingMode.ARENA_BONUS_TYPE_TOURNAMENT;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    // ---- 死亡时间 UNKNOWN(0) = 证据缺失，不是冲突 ----

    @Test
    void unknownVsUnknownDeathTimeIsConsistent() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 0;
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 0;
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void unknownVsKnownDeathTimeIsConsistent() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 0;    // UNKNOWN
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 128.12; // KNOWN
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
        assertTrue(LeagueRatingConflictDetector.consistent(b, a),
                "KNOWN + UNKNOWN 必须与 UNKNOWN + KNOWN 一致（对称）");
    }

    @Test
    void knownVsKnownWithinToleranceIsConsistent() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 128.12;
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 128.50;
        assertTrue(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void knownVsKnownBeyondToleranceConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 100.0;
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 128.0;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b),
                "两个互相矛盾的 KNOWN 死亡时间超过容差 → 冲突");
    }

    @Test
    void invalidDeathTimeConflictsWithAnything() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = -1;   // 非法 stat fact
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 128.0;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    // ---- INVALID fail-closed：UNKNOWN 不是 wildcard，不能把 INVALID 洗成 UNKNOWN ----

    @Test
    void unknownPlusNegativeConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 0;    // UNKNOWN
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = -1;   // INVALID
        assertFalse(LeagueRatingConflictDetector.consistent(a, b),
                "UNKNOWN + INVALID negative 必须 conflict（fail closed，不得洗成 UNKNOWN）");
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void unknownPlusNaNConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 0;
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = Double.NaN;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void unknownPlusInfinityConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 0;
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = Double.POSITIVE_INFINITY;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void knownPlusInvalidConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 128.0;
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = Double.NaN;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    // ---- Survivor INVALID fail-closed：survived shortcut 不得绕过 stat-fact validity ----

    @Test
    void survivorValidPlusNaNCConflicts() {
        // 双方 survived=true，但 B 的 survivalTimeSec=NaN：Validator 对全玩家拒绝，
        // 一致性也必须 fail closed（否则上传顺序决定是否评分）。
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = true;
        a.players.get(0).survivalTimeSec = 300;
        b.players.get(0).survived = true;
        b.players.get(0).survivalTimeSec = Double.NaN;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b),
                "survivor valid + NaN 必须 conflict（INVALID first，survived shortcut 不得绕过）");
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void survivorValidPlusInfinityConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = true;
        a.players.get(0).survivalTimeSec = 300;
        b.players.get(0).survived = true;
        b.players.get(0).survivalTimeSec = Double.POSITIVE_INFINITY;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void survivorValidPlusNegativeConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = true;
        a.players.get(0).survivalTimeSec = 300;
        b.players.get(0).survived = true;
        b.players.get(0).survivalTimeSec = -1;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        assertFalse(LeagueRatingConflictDetector.consistent(b, a));
    }

    @Test
    void twoValidSurvivorsDoNotUseDeathTimeTolerance() {
        // 两个存活玩家的合法 survivalTimeSec 不同（300 vs 301.5）不是 conflict：
        // death-time UNKNOWN/KNOWN/1s tolerance 只属于阵亡玩家，不得错套给 survivor。
        final Battle a = battle();
        final Battle b = battle();
        a.players.get(0).survived = true;
        a.players.get(0).survivalTimeSec = 300;
        b.players.get(0).survived = true;
        b.players.get(0).survivalTimeSec = 301.5;
        assertTrue(LeagueRatingConflictDetector.consistent(a, b),
                "两个合法 survivor 的 finite survivalTimeSec 差异不是死亡时间 conflict");
        assertTrue(LeagueRatingConflictDetector.consistent(b, a));
    }

    // ---- hard-conflict 字段（settlement / duration / received stats / clan）----

    @Test
    void settlementCoverageMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.settlementAccountsCoveredByRoster = false;   // ROSTER_INCOMPLETE 判定不同
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void settlementTeamConsistencyMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.settlementRosterTeamConsistent = false;
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void durationMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.durationS = 500.0;   // 影响死亡时间 &gt; duration + 1s 的非法判定
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    @Test
    void receivedStatsMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.players.get(0).nHitsReceived = 9;          // validator 非法值检查参与字段
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
        final Battle c = battle();
        c.players.get(0).nPenetrationsReceived = 4;
        assertFalse(LeagueRatingConflictDetector.consistent(a, c));
        final Battle d = battle();
        d.players.get(0).nEnemiesDamaged = 6;
        assertFalse(LeagueRatingConflictDetector.consistent(a, d));
    }

    @Test
    void clanMismatchConflicts() {
        final Battle a = battle();
        final Battle b = battle();
        b.players.get(0).clan = "XYZ";   // 影响 team autoName / teamKey / batch summary identity
        assertFalse(LeagueRatingConflictDetector.consistent(a, b));
    }

    // ---- group-level all-pairs（UNKNOWN 不能作 wildcard 隔开互相矛盾的 KNOWN）----

    @Test
    void groupUnknownSeparatedConflictingKnownsRejectedAllOrders() {
        // [UNKNOWN, KNOWN100, KNOWN128]：UNKNOWN 与两个 KNOWN 各 pair 都一致，
        // 但 KNOWN100 vs KNOWN128 超容差 → 无论上传顺序都必须 conflict。
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
        // [UNKNOWN, KNOWN128.12, KNOWN128.50]：KNOWN 互相一致（≤1s）→ 全部顺序不 conflict，
        // canonical = min KNOWN = 128.12（与顺序无关）。
        final double[][] orders = {
                {0, 128.12, 128.50}, {0, 128.50, 128.12}, {128.12, 0, 128.50},
                {128.12, 128.50, 0}, {128.50, 0, 128.12}, {128.50, 128.12, 0}};
        for (final double[] o : orders) {
            final List<Battle> copies = java.util.Arrays.stream(o)
                    .mapToObj(t -> battleWithDeath(t)).toList();
            assertTrue(LeagueRatingConflictDetector.validateAndReconcile(copies),
                    "order " + java.util.Arrays.toString(o) + " 必须 not conflict");
            assertEquals(128.12, copies.getFirst().players.get(0).survivalTimeSec, 1e-9,
                    "canonical 必须是最小 KNOWN 128.12（与顺序无关）");
        }
    }

    @Test
    void reconcileNeverSanitizesInvalidToUnknown() {
        // canonicalizer 只处理合法 UNKNOWN(0) / KNOWN(&gt;0)；INVALID 必须先被一致性拒绝，
        // 绝不把 -1 洗成 0（validateAndReconcile 在 conflict 时不执行任何 mutation）。
        final Battle invalid = battle();
        invalid.players.get(0).survived = false;
        invalid.players.get(0).survivalTimeSec = -1;
        final Battle unknown = battle();
        unknown.players.get(0).survived = false;
        unknown.players.get(0).survivalTimeSec = 0;
        assertFalse(LeagueRatingConflictDetector.validateAndReconcile(List.of(invalid, unknown)));
        assertEquals(-1, invalid.players.get(0).survivalTimeSec, 1e-9,
                "conflict 不得修改任何副本（INVALID 不得被洗成 UNKNOWN）");

        // 直接调用 reconcileDeathTimes（防御性）：没有 KNOWN 证据时不得改动非法值
        LeagueRatingConflictDetector.reconcileDeathTimes(invalid, List.of(invalid, unknown));
        assertEquals(-1, invalid.players.get(0).survivalTimeSec, 1e-9,
                "canonicalizer 不得清洗 INVALID");
    }

    private static Battle battleWithDeath(final double survivalTimeSec) {
        final Battle b = battle();
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = survivalTimeSec;
        return b;
    }

    // ---- 确定性 canonical 死亡时间收口 ----

    @Test
    void reconcileUnknownAndKnownUsesKnown() {
        final Battle unknown = battle();
        unknown.players.get(0).survived = false;
        unknown.players.get(0).survivalTimeSec = 0;
        final Battle known = battle();
        known.players.get(0).survived = false;
        known.players.get(0).survivalTimeSec = 128.12;
        LeagueRatingConflictDetector.reconcileDeathTimes(unknown, List.of(unknown, known));
        assertEquals(128.12, unknown.players.get(0).survivalTimeSec, 1e-9,
                "UNKNOWN + KNOWN → canonical 使用 KNOWN");
        // 反向顺序：结果一致（确定性）
        final Battle knownFirst = battle();
        knownFirst.players.get(0).survived = false;
        knownFirst.players.get(0).survivalTimeSec = 128.12;
        final Battle unknownSecond = battle();
        unknownSecond.players.get(0).survived = false;
        unknownSecond.players.get(0).survivalTimeSec = 0;
        LeagueRatingConflictDetector.reconcileDeathTimes(knownFirst, List.of(knownFirst, unknownSecond));
        assertEquals(128.12, knownFirst.players.get(0).survivalTimeSec, 1e-9);
    }

    @Test
    void reconcileAllUnknownStaysUnknown() {
        final Battle a = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 0;
        final Battle b = battle();
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 0;
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(0.0, a.players.get(0).survivalTimeSec, 1e-9);
    }

    @Test
    void reconcileKnownKnownUsesDeterministicMin() {
        final Battle a = battle();
        a.players.get(0).survived = false;
        a.players.get(0).survivalTimeSec = 128.50;
        final Battle b = battle();
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 128.12;
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.12, a.players.get(0).survivalTimeSec, 1e-9);
        // 顺序交换 → 相同 canonical
        final Battle c = battle();
        c.players.get(0).survived = false;
        c.players.get(0).survivalTimeSec = 128.12;
        final Battle d = battle();
        d.players.get(0).survived = false;
        d.players.get(0).survivalTimeSec = 128.50;
        LeagueRatingConflictDetector.reconcileDeathTimes(c, List.of(c, d));
        assertEquals(128.12, c.players.get(0).survivalTimeSec, 1e-9);
    }

    @Test
    void reconcileLeavesSurvivorsUntouched() {
        final Battle a = battle();
        final Battle b = battle();
        b.players.get(0).survived = false;
        b.players.get(0).survivalTimeSec = 128.12;
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(300.0, a.players.get(0).survivalTimeSec, 1e-9, "存活玩家不得被收口");
    }
}
