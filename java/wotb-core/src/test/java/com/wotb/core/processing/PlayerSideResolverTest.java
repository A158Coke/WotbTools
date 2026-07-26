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

    // ========== 8.1 Recorder in raw team 1 ==========

    @Test
    void recorderTeam1_selfIsFriendly() {
        assertEquals(Side.FRIENDLY, PlayerSideResolver.resolve(1, 1));
    }

    @Test
    void recorderTeam1_team1IsFriendly() {
        assertEquals(Side.FRIENDLY, PlayerSideResolver.resolve(1, 1));
    }

    @Test
    void recorderTeam1_team2IsEnemy() {
        assertEquals(Side.ENEMY, PlayerSideResolver.resolve(1, 2));
    }

    @Test
    void recorderTeam1_promptContainsNoTeam1Team2() {
        // Verify via battle integration
        Battle battle = createBattle(1, List.of(
                player(1, "Ally"),
                player(2, "Enemy")
        ));
        Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        assertEquals(Side.FRIENDLY, sides.get(battle.players.get(0)));
        assertEquals(Side.ENEMY, sides.get(battle.players.get(1)));
    }

    // ========== 8.2 Recorder in raw team 2 ==========

    @Test
    void recorderTeam2_selfIsFriendly() {
        assertEquals(Side.FRIENDLY, PlayerSideResolver.resolve(2, 2));
    }

    @Test
    void recorderTeam2_team2IsFriendly() {
        Battle battle = createBattle(2, List.of(
                player(2, "Teammate"),
                player(1, "Foe")
        ));
        Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
        assertEquals(Side.FRIENDLY, sides.get(battle.players.get(0)));
        assertEquals(Side.ENEMY, sides.get(battle.players.get(1)));
    }

    @Test
    void recorderTeam2_team1IsEnemy() {
        assertEquals(Side.ENEMY, PlayerSideResolver.resolve(2, 1));
    }

    @Test
    void recorderTeam2_notHardcodedTeam1AsFriendly() {
        // Critical regression: must NOT assume team 1 = friendly
        Battle battle = createBattle(2, List.of(
                player(1, "ActuallyEnemy"),
                player(2, "ActuallyFriendly")
        ));
        Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
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

    // ========== 8.4 Unknown cases ==========

    @Test
    void recorderResultMissing_unknown() {
        Battle battle = new Battle();
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void recorderTeamZero_unknown() {
        Battle battle = createBattle(0, List.of(player(1, "P1")));
        assertNull(PlayerSideResolver.resolveRecorderTeam(battle));
    }

    @Test
    void playerTeamZero_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(1, 0));
    }

    @Test
    void nullBattle_unknown() {
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(null, new PlayerResult()));
    }

    @Test
    void nullPlayer_unknown() {
        Battle battle = createBattle(1, List.of(player(1, "P1")));
        assertEquals(Side.UNKNOWN, PlayerSideResolver.resolve(battle, null));
    }

    @Test
    void winnerTeamInvalid_drawOrUnknown() {
        assertEquals(Winner.DRAW_OR_UNKNOWN, FriendlyEnemyResult.resolve(-1, 1));
    }

    // ========== 8.5 Multi-Player: each battle independent ==========

    @Test
    void multiPlayer_eachBattleIndependent() {
        // Battle A: recorderTeam=1
        Battle battleA = createBattle(1, List.of(
                player(1, "A_Friendly"),
                player(2, "A_Enemy")
        ));
        // Battle B: recorderTeam=2
        Battle battleB = createBattle(2, List.of(
                player(2, "B_Friendly"),
                player(1, "B_Enemy")
        ));

        // Both recorders must be FRIENDLY in their own battle
        Map<PlayerResult, Side> sidesA = PlayerSideResolver.resolveAll(battleA);
        Map<PlayerResult, Side> sidesB = PlayerSideResolver.resolveAll(battleB);

        assertEquals(Side.FRIENDLY, sidesA.get(battleA.players.get(0)), "Battle A team1 is friendly");
        assertEquals(Side.ENEMY, sidesA.get(battleA.players.get(1)), "Battle A team2 is enemy");
        assertEquals(Side.FRIENDLY, sidesB.get(battleB.players.get(0)), "Battle B team2 is friendly");
        assertEquals(Side.ENEMY, sidesB.get(battleB.players.get(1)), "Battle B team1 is enemy");

        // Verify raw team numbers are preserved (PlayerResult.team not modified)
        assertEquals(1, battleA.players.get(0).team);
        assertEquals(2, battleA.players.get(1).team);
        assertEquals(2, battleB.players.get(0).team);
        assertEquals(1, battleB.players.get(1).team);
    }

    // ========== Helpers ==========

    private static Battle createBattle(int recorderTeam, List<PlayerResult> players) {
        Battle battle = new Battle();
        battle.recorder = "Recorder";
        battle.players = players;
        // Set the player with recorderTeam as the recorder
        PlayerResult rec = players.stream()
                .filter(p -> p.team == recorderTeam)
                .findFirst()
                .orElse(null);
        if (rec != null) {
            rec.nickname = "Recorder";
        }
        return battle;
    }

    private static PlayerResult player(int team, String nickname) {
        PlayerResult p = new PlayerResult();
        p.team = team;
        p.nickname = nickname;
        return p;
    }
}
