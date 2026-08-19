package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.PlayerSideResolver.Side;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for PlayerAnalysisPromptFormatter.
 * Verifies that formatted output uses FRIENDLY / ENEMY / UNKNOWN labels
 * and does NOT contain "队伍1", "队伍2", "Team 1", "Team 2".
 */
class PlayerAnalysisPromptFormatterTest {

    @Test
    void formatRecorderLine_addressesThePlayerAsSecondPerson() {
        final Battle battle = createBattle(1, List.of(player(1, "Recorder")));
        final PlayerResult rec = battle.recorderResult();
        final Side side = PlayerSideResolver.resolve(battle, rec);
        final String line = PlayerAnalysisPromptFormatter.formatRecorderLine(rec, side);
        // 复盘直接面向玩家本人：用「你」，且本人不带阵营标签
        assertTrue(line.startsWith("你: "), "Should address the player as 你, got: " + line);
        assertFalse(line.contains("录像者"), "Must not call the player 录像者, got: " + line);
        assertFalse(line.contains("友方"), "The player must never be labelled 友方, got: " + line);
        assertFalse(line.contains("侧="), "The player carries no side label, got: " + line);
        assertFalse(line.contains("队伍1"), "Must not contain raw team number");
        assertFalse(line.contains("队伍2"), "Must not contain raw team number");
        assertTrue(line.contains(" | "), "Should use | separators");
    }

    @Test
    void formatRecorderLine_team2AlsoUsesSecondPerson() {
        final Battle battle = createBattle(2, List.of(player(2, "Recorder")));
        final PlayerResult rec = battle.recorderResult();
        final Side side = PlayerSideResolver.resolve(battle, rec);
        final String line = PlayerAnalysisPromptFormatter.formatRecorderLine(rec, side);
        assertTrue(line.startsWith("你: "), "Recorder in team 2 is still 你, got: " + line);
        assertFalse(line.contains("友方"), line);
    }

    @Test
    void sameTeamPlayersAreLabelledTeammateNotFriendly() {
        final Battle battle = createBattle(1, List.of(player(1, "Recorder"), player(1, "Mate")));
        final String output = PlayerAnalysisPromptFormatter.formatAllPlayersBySide(battle);
        assertTrue(output.contains("队友"), "Same-team players are 队友, got: " + output);
        assertFalse(output.contains("友方"), "友方 must not appear, got: " + output);
    }

    @Test
    void fallbackNeverListsThePlayerAmongTeammates() {
        // 降级路径（无特征集）：本人只出现在「你」段，不得再出现在队友段
        final Battle battle = createBattle(1, List.of(player(1, "Recorder"), player(1, "Mate")));
        final String output = PlayerAnalysisPromptFormatter.formatAllPlayersBySide(battle);

        assertTrue(output.contains("=== 你 ==="), output);
        assertTrue(output.contains("你: \"Recorder\""), output);
        assertTrue(output.contains("=== 队友 ==="), output);
        assertTrue(output.contains("队友 \"Mate\""), output);
        // 队友段里绝不能再出现本人
        final String teammateSection = output.substring(output.indexOf("=== 队友 ==="));
        assertFalse(teammateSection.contains("Recorder"),
                "The player must not be repeated as a teammate, got: " + teammateSection);
    }

    @Test
    void missingAccountIdsDoNotCollapseTheWholeTeamIntoThePlayer() {
        // 缺失 identity 的回放里所有 accountId 都是 0：
        // 若按 accountId 判定本人，整队都会被当成本人而消失
        final Battle battle = createBattle(1, List.of(
                player(1, "Recorder"), player(1, "MateA"), player(1, "MateB")));
        final String output = PlayerAnalysisPromptFormatter.formatAllPlayersBySide(battle);

        assertTrue(output.contains("MateA"), output);
        assertTrue(output.contains("MateB"), output);
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
        // 该 fixture 只有「本人 + 对手」：本人单独成段，对手在敌方段，无队友
        assertTrue(output.contains("=== 你 ==="), "Should contain the player section, got: " + output);
        assertTrue(output.contains("敌方"), "Should contain enemy label, got: " + output);
        assertFalse(output.contains("友方"), "友方 must not appear, got: " + output);
        assertFalse(output.contains("=== 队友 ==="),
                "No teammates in this fixture, got: " + output);
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
