package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 同 arenaId 多份回放关键事实一致性（plan §4/§21.2）。 */
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
