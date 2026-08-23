package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

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
}
