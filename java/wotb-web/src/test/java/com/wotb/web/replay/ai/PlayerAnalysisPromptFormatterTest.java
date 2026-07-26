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
    void formatRecorderLine_team1_containsFriendlyLabel() {
        Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        PlayerResult rec = battle.recorderResult();
        Side side = PlayerSideResolver.resolve(battle, rec);
        String line = PlayerAnalysisPromptFormatter.formatRecorderLine(rec, side);
        assertTrue(line.contains("友方") || line.contains("FRIENDLY"),
                "Should contain friendly label, got: " + line);
        assertFalse(line.contains("队伍1"), "Must not contain raw team number");
        assertFalse(line.contains("队伍2"), "Must not contain raw team number");
    }

    @Test
    void formatRecorderLine_team2_containsFriendlyLabel() {
        Battle battle = createBattle(2, List.of(player(2, "Recorder")));
        PlayerResult rec = battle.recorderResult();
        Side side = PlayerSideResolver.resolve(battle, rec);
        String line = PlayerAnalysisPromptFormatter.formatRecorderLine(rec, side);
        assertTrue(line.contains("友方") || line.contains("FRIENDLY"),
                "Recorder in team 2 should also be friendly, got: " + line);
    }

    @Test
    void formatAllPlayersBySide_noTeamNumbers() {
        Battle battle = createBattle(1, List.of(
                player(1, "Ally"),
                player(2, "Foe")
        ));
        String output = PlayerAnalysisPromptFormatter.formatAllPlayersBySide(battle);
        assertFalse(output.contains("队伍1"), "Output must not contain 队伍1");
        assertFalse(output.contains("队伍2"), "Output must not contain 队伍2");
        assertTrue(output.contains("友方") || output.contains("FRIENDLY"),
                "Output should contain friendly label");
        assertTrue(output.contains("敌方") || output.contains("ENEMY"),
                "Output should contain enemy label");
    }

    @Test
    void formatWinner_friendlyWin() {
        Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        battle.winnerTeam = 1;
        String output = PlayerAnalysisPromptFormatter.formatWinner(battle);
        assertTrue(output.contains("友方获胜") || output.contains("FRIENDLY_WIN"),
                "Winner output should indicate friendly win, got: " + output);
        assertFalse(output.contains("胜方队伍"), "Must not use raw winner team display");
    }

    @Test
    void formatWinner_enemyWin() {
        Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        battle.winnerTeam = 2;
        String output = PlayerAnalysisPromptFormatter.formatWinner(battle);
        assertTrue(output.contains("敌方获胜") || output.contains("ENEMY_WIN"),
                "Winner output should indicate enemy win, got: " + output);
    }

    @Test
    void formatWinner_drawOrUnknown() {
        Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        battle.winnerTeam = null;
        String output = PlayerAnalysisPromptFormatter.formatWinner(battle);
        assertTrue(output.contains("平局") || output.contains("DRAW_OR_UNKNOWN"),
                "Winner output should indicate draw/unknown, got: " + output);
    }

    @Test
    void formatSideStats_containsSideLabel() {
        List<PlayerResult> friendlies = List.of(player(1, "P1"));
        String stats = PlayerAnalysisPromptFormatter.formatSideStats(friendlies, Side.FRIENDLY);
        assertFalse(stats.contains("队伍1"));
        assertTrue(stats.contains("友方") || stats.contains("FRIENDLY"));
    }

    // ========== Helpers ==========

    private static Battle createBattle(int recorderTeam, List<PlayerResult> players) {
        Battle battle = new Battle();
        battle.recorder = "Recorder";
        battle.players = players;
        PlayerResult rec = players.stream()
                .filter(p -> p.team == recorderTeam)
                .findFirst().orElse(null);
        if (rec != null) rec.nickname = "Recorder";
        return battle;
    }

    private static PlayerResult player(int team, String nickname) {
        PlayerResult p = new PlayerResult();
        p.team = team;
        p.nickname = nickname;
        p.damageDealt = 1000;
        return p;
    }
}
