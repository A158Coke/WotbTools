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

    @Test
    void nonRatingIdentityFieldsDoNotChangeFingerprint() {
        // rosterComplete / #201 evidence / clan / killer-result-entity / reconstruction provenance are
        // NOT Rating identity → copies differing only on these are still duplicates.
        final Battle left = battle();
        final Battle right = battle();
        right.rosterComplete = false;
        right.players.getFirst().clan = "OTHER";
        right.players.getFirst().killerAccountId = 999L;
        right.players.getFirst().settlementKillerResultEntityId = 123L;
        right.players.getFirst().settlementResultEntityId = 456L;
        assertTrue(LeagueRatingConflictDetector.consistent(left, right),
                "非 Rating identity 字段不得改变 League 指纹");
        assertTrue(LeagueRatingConflictDetector.validateCopies(List.of(left, right)));
    }

    @Test
    void ratingStatMismatchConflicts() {
        final Battle left = battle();
        final Battle right = battle();
        right.players.getFirst().damageDealt = 99999;
        assertFalse(LeagueRatingConflictDetector.consistent(left, right),
                "Rating 消费的 settlement 统计不一致必须冲突");
    }

    @Test
    void cannonicalFirstCopyBeatsAllPairs() {
        final Battle canonical = battle();
        final Battle same = battle();
        final Battle diff = battle();
        diff.players.get(1).kills = 5;
        // canonical + same → duplicate; any conflicting copy → group conflict.
        assertTrue(LeagueRatingConflictDetector.validateCopies(List.of(canonical, same)));
        assertFalse(LeagueRatingConflictDetector.validateCopies(List.of(canonical, same, diff)));
    }
}
