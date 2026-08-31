package com.wotb.core.league;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** League duplicate identity is based on settlement facts, never live provenance. */
class LeagueRatingConflictDetectorTest {

    private static Battle battle() {
        return LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
    }

    @Test
    void identicalCopiesAreConsistent() {
        assertTrue(LeagueRatingConflictDetector.consistent(battle(), battle()));
    }

    @Test
    void settlementFactsMismatchConflicts() {
        final Battle left = battle();
        final Battle right = battle();
        right.players.getFirst().settlementLifeTimeSec = 120;
        right.players.getFirst().survived = false;
        assertFalse(LeagueRatingConflictDetector.consistent(left, right));
    }

    @Test
    void liveObservationDoesNotChangeLeagueIdentity() {
        final Battle left = battle();
        final Battle right = battle();
        assertTrue(LeagueRatingConflictDetector.validateCopies(List.of(left, right)));
    }

    @Test
    void groupCheckNeverMutatesRetainedBattle() {
        final Battle left = battle();
        final double before = left.players.getFirst().survivalTimeSec;
        assertTrue(LeagueRatingConflictDetector.validateCopies(List.of(left, battle())));
        org.junit.jupiter.api.Assertions.assertEquals(before,
                left.players.getFirst().survivalTimeSec, 1e-9);
    }
}
