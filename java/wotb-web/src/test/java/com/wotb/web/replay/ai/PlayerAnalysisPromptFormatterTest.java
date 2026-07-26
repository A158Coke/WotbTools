package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.*;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.PlayerSideResolver.Side;
import org.junit.jupiter.api.Test;

import java.util.List;

/**
 * Tests for PlayerAnalysisPromptFormatter.
 * Verifies that formatted output uses FRIENDLY / ENEMY / UNKNOWN labels
 * and does NOT contain "队伍1", "队伍2", "Team 1", "Team 2".
 */
class PlayerAnalysisPromptFormatterTest {

    @Test
    void formatRecorderLine_containsFriendlyLabel() {
        final Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        final PlayerResult rec = battle.recorderResult();
        final Side side = PlayerSideResolver.resolve(battle, rec);
        final String line = PlayerAnalysisPromptFormatter.formatRecorderLine(rec, side);
        assertTrue(line.contains("侧=友方") || line.contains("侧=FRIENDLY"),
                "Should contain side label, got: " + line);
        assertFalse(line.contains("队伍1"), "Must not contain raw team number");
        assertFalse(line.contains("队伍2"), "Must not contain raw team number");
        // Verify proper separators
        assertTrue(line.contains(" | "), "Should use | separators");
    }

    @Test
    void formatRecorderLine_team2StillFriendly() {
        final Battle battle = createBattle(2, List.of(player(2, "Recorder")));
        final PlayerResult rec = battle.recorderResult();
        final Side side = PlayerSideResolver.resolve(battle, rec);
        final String line = PlayerAnalysisPromptFormatter.formatRecorderLine(rec, side);
        assertTrue(line.contains("侧=友方"), "Recorder in team 2 should also be friendly, got: " + line);
    }

    @Test
    void formatAllPlayersBySide_noTeamNumbers() {
        final Battle battle = createBattle(1, List.of(
                player(1, "Ally"),
                player(2, "Foe")
        ));
        final String output = PlayerAnalysisPromptFormatter.formatAllPlayersBySide(battle);
        assertFalse(output.contains("队伍1"), "Output must not contain 队伍1");
        assertFalse(output.contains("队伍2"), "Output must not contain 队伍2");
        assertTrue(output.contains("友方") || output.contains("FRIENDLY"), "Should contain friendly label");
        assertTrue(output.contains("敌方") || output.contains("ENEMY"), "Should contain enemy label");
    }

    @Test
    void formatWinner_friendlyWin() {
        final Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        battle.winnerTeam = 1;
        final String output = PlayerAnalysisPromptFormatter.formatWinner(battle);
        assertTrue(output.contains("友方获胜") || output.contains("FRIENDLY_WIN"),
                "Should indicate friendly win, got: " + output);
        assertFalse(output.contains("胜方队伍"), "Must not use raw winner team display");
    }

    @Test
    void formatWinner_enemyWin() {
        final Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        battle.winnerTeam = 2;
        final String output = PlayerAnalysisPromptFormatter.formatWinner(battle);
        assertTrue(output.contains("敌方获胜") || output.contains("ENEMY_WIN"),
                "Should indicate enemy win, got: " + output);
    }

    @Test
    void formatWinner_drawOrUnknown() {
        final Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        battle.winnerTeam = null;
        final String output = PlayerAnalysisPromptFormatter.formatWinner(battle);
        assertTrue(output.contains("平局") || output.contains("DRAW_OR_UNKNOWN"),
                "Should indicate draw/unknown, got: " + output);
    }

    // ========== Helpers ==========

    private static Battle createBattle(final int recorderTeam, final List<PlayerResult> players) {
        final Battle battle = new Battle();
        battle.recorder = "Recorder";
        battle.players = players;
        final PlayerResult rec = players.stream()
                .filter(p -> p.team == recorderTeam)
                .findFirst().orElse(null);
        if (rec != null) rec.nickname = "Recorder";
        return battle;
    }

    private static PlayerResult player(final int team, final String nickname) {
        final PlayerResult p = new PlayerResult();
        p.team = team;
        p.nickname = nickname;
        p.damageDealt = 1000;
        return p;
    }
}
