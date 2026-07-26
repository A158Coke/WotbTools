package com.wotb.core.processing;

import static org.junit.jupiter.api.Assertions.*;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.PlayerSideResolver.Side;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

/**
 * Tests for PlayerSideResolver and FriendlyEnemyResult covering sections 8.1–8.5.
 * Does NOT modify PlayerResult.team (the raw number is preserved).
 */
class PlayerSideResolverTest {

    // ========== isValidRawTeam ==========

    @Test
    void isValidRawTeam_1() { assertTrue(PlayerSideResolver.isValidRawTeam(1)); }

    @Test
    void isValidRawTeam_2() { assertTrue(PlayerSideResolver.isValidRawTeam(2)); }

    @Test
    void isValidRawTeam_negative1() { assertFalse(PlayerSideResolver.isValidRawTeam(-1)); }

    @Test
    void isValidRawTeam_zero() { assertFalse(PlayerSideResolver.isValidRawTeam(0)); }

    @Test
    void isValidRawTeam_3() { assertFalse(PlayerSideResolver.isValidRawTeam(3)); }

    @Test
    void isValidRawTeam_maxInt() { assertFalse(PlayerSideResolver.isValidRawTeam(Integer.MAX_VALUE)); }

    // ========== 8.1 Recorder in raw team 1 ==========

    @Test
    void recorderTeam1_selfIsFriendly() {
        assertEquals(Side.FRIENDLY, PlayerSideResolver.resolve(1, 1));
    }

    @Test
    void recorderTeam1_team2IsEnemy() {
        assertEquals(Side.ENEMY, PlayerSideResolver.resolve(1, 2));
    }

    // ========== 8.2 Recorder in raw team 2 ==========

    @Test
    void recorderTeam2_selfIsFriendly() {
        assertEquals(Side.FRIENDLY, PlayerSideResolver.resolve(2, 2));
    }

    @Test
    void recorderTeam2_team1IsEnemy() {
        assertEquals(Side.ENEMY, PlayerSideResolver.resolve(2, 1));
    }

    @Test
    void recorderTeam2_notHardcodedTeam1AsFriendly() {
        final Battle battle = createBattle(2, List.of(
                player(1, "ActuallyEnemy"),
                player(2, "ActuallyFriendly")
        ));
        final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        assertEquals(Side.ENEMY, sides.get(battle.players.get(0)));
        assertEquals(Side.FRIENDLY, sides.get(battle.players.get(1)));
    }

    // ========== 8.3 Winner conversion ==========

    @Test
    void winnerEqualsRecorderTeam_friendlyWin() {
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(1, 1));
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(2, 2));
    }

    @Test
    void winnerDiffersFromRecorderTeam_enemyWin() {
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(2, 1));
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(1, 2));
    }

    @Test
    void winnerNull_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(null, 1));
    }

    @Test
    void winnerZero_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(0, 1));
    }

    @Test
    void winnerTeam3_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(3, 1));
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(Integer.MAX_VALUE, 1));
    }

    // ========== 8.4 Unknown cases ==========

    @Test
    void recorderResultMissing_unknown() {
        final Battle battle = new Battle();
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void recorderTeamZero_unknown() {
        final Battle battle = createBattle(0, List.of(player(1, "P1")));
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void recorderTeam3_unknown() {
        final Battle battle = createBattle(3, List.of(player(3, "P1")));
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void playerTeamZero_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(1, 0));
    }

    @Test
    void playerTeam3_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(1, 3));
    }

    @Test
    void nullBattle_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(null, new PlayerResult()));
    }

    @Test
    void nullPlayer_unknown() {
        final Battle battle = createBattle(1, List.of(player(1, "P1")));
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(battle, null));
    }

    @Test
    void winnerTeamInvalid_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(-1, 1));
    }

    // ========== 8.5 Multi-Player ==========

    @Test
    void multiPlayer_eachBattleIndependent() {
        final Battle battleA = createBattle(1, List.of(
                player(1, "A_Friendly"),
                player(2, "A_Enemy")
        ));
        final Battle battleB = createBattle(2, List.of(
                player(2, "B_Friendly"),
                player(1, "B_Enemy")
        ));

        final Map<PlayerResult, Side> sidesA = PlayerSideResolver.resolveAll(battleA);
        final Map<PlayerResult, Side> sidesB = PlayerSideResolver.resolveAll(battleB);

        assertEquals(Side.FRIENDLY, sidesA.get(battleA.players.get(0)), "Battle A team1 is friendly");
        assertEquals(Side.ENEMY, sidesA.get(battleA.players.get(1)), "Battle A team2 is enemy");
        assertEquals(Side.FRIENDLY, sidesB.get(battleB.players.get(0)), "Battle B team2 is friendly");
        assertEquals(Side.ENEMY, sidesB.get(battleB.players.get(1)), "Battle B team1 is enemy");

        // Verify raw team numbers are preserved
        assertEquals(1, battleA.players.get(0).team);
        assertEquals(2, battleA.players.get(1).team);
        assertEquals(2, battleB.players.get(0).team);
        assertEquals(1, battleB.players.get(1).team);
    }

    // ========== 5. Recorder team 2 correctness ==========

    @Test
    void recorderTeam2_friendlyWin() {
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(2, 2));
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(1, 2));
    }

    @Test
    void recorderTeam1_friendlyWin() {
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolve(1, 1));
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolve(2, 1));
    }

    // ========== Helpers ==========

    private static Battle createBattle(final int recorderTeam, final List<PlayerResult> players) {
        final Battle battle = new Battle();
        battle.recorder = "Recorder";
        battle.players = players;
        final PlayerResult rec = players.stream()
                .filter(p -> p.team == recorderTeam)
                .findFirst().orElse(null);
        if (rec != null) {
            rec.nickname = "Recorder";
        }
        return battle;
    }

    private static PlayerResult player(final int team, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.team = team;
        p.nickname = nickname;
        return p;
    }
}
