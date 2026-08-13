package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.PointsEndReason;
import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.FriendlyEnemyResult.WinnerSource;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 全歼后缀 fail-closed 边界：队伍缺失 / players 为 null 或空 / 非法视角一律不得输出
 * 「全歼敌方/被敌方全歼」，避免把未知当成零存活；双方 roster 齐全时真实全歼仍正常输出。
 */
class TeamResultSourceBoundaryTest {

    private static PlayerResult player(final long id, final int team, final boolean survived) {
        final PlayerResult p = new PlayerResult();
        p.accountId = id;
        p.nickname = "P" + id;
        p.team = team;
        p.survived = survived;
        return p;
    }

    private static Battle battle(final List<PlayerResult> players, final Integer winnerTeam) {
        final Battle b = new Battle();
        b.arenaBonusType = 3;
        b.winnerTeam = winnerTeam;
        b.durationS = 300.0;
        b.players = players;
        return b;
    }

    private static List<PlayerResult> friendlyRoster(final boolean survived) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            players.add(player(10_001L + i, 1, survived));
        }
        return players;
    }

    private static List<PlayerResult> enemyRoster(final boolean survived) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            players.add(player(20_001L + i, 2, survived));
        }
        return players;
    }

    private static List<PlayerResult> bothRosters(
            final boolean friendlySurvived, final boolean enemySurvived) {
        final List<PlayerResult> players = new ArrayList<>(friendlyRoster(friendlySurvived));
        players.addAll(enemyRoster(enemySurvived));
        return players;
    }

    private static TeamBattleWinner win(final Winner winner) {
        return new TeamBattleWinner(winner, WinnerSource.BATTLE_RESULTS, false,
                PointsEndReason.NOT_APPLICABLE);
    }

    @Test
    void annihilationSuffixFailClosedOnBoundaryInputs() {
        assertTrue(FriendlyEnemyResult.annihilationSuffix(null, 1, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(null, 1), 1, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(List.of(), 1), 1, Winner.FRIENDLY_WIN).isEmpty());
        // 仅本方阵容（对方队伍缺失）
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(friendlyRoster(false), 1), 1, Winner.FRIENDLY_WIN).isEmpty());
        // 仅敌方阵容（本方队伍缺失）
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(enemyRoster(false), 2), 1, Winner.ENEMY_WIN).isEmpty());
        // 非法视角
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(bothRosters(false, true), 1), 0, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(bothRosters(false, true), 1), 3, Winner.FRIENDLY_WIN).isEmpty());
    }

    @Test
    void teamResultLineNeverReportsAnnihilationOnBoundaryInputs() {
        assertFalse(TeamEvidenceFormatter.resolveTeamResult(null, 1, "CHRD").contains("全歼"));
        assertFalse(TeamEvidenceFormatter.resolveTeamResult(
                battle(null, 1), 1, "CHRD").contains("全歼"));
        assertFalse(TeamEvidenceFormatter.resolveTeamResult(
                battle(List.of(), 1), 1, "CHRD").contains("全歼"));
        assertFalse(TeamEvidenceFormatter.resolveTeamResult(
                battle(friendlyRoster(false), 1), 1, "CHRD").contains("全歼"));
        assertFalse(TeamEvidenceFormatter.resolveTeamResult(
                battle(enemyRoster(false), 2), 1, "CHRD").contains("全歼"));
        assertFalse(TeamEvidenceFormatter.resolveTeamResult(
                battle(bothRosters(false, true), 1), 0, "CHRD").contains("全歼"));
        assertFalse(TeamEvidenceFormatter.resolveTeamResult(
                battle(bothRosters(false, true), 1), 3, "CHRD").contains("全歼"));
    }

    @Test
    void autopsyResultLineNeverReportsAnnihilationOnBoundaryInputs() {
        assertFalse(TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", null, 1).contains("全歼"));
        assertFalse(TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", battle(null, 1), 1).contains("全歼"));
        assertFalse(TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", battle(List.of(), 1), 1).contains("全歼"));
        assertFalse(TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", battle(friendlyRoster(false), 1), 1).contains("全歼"));
        assertFalse(TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.ENEMY_WIN), "CHRD", battle(enemyRoster(false), 2), 1).contains("全歼"));
        assertFalse(TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", battle(bothRosters(false, true), 1), 0).contains("全歼"));
        assertFalse(TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", battle(bothRosters(false, true), 1), 3).contains("全歼"));
    }

    @Test
    void autopsyUserContentResultRowCarriesSourceButNoAnnihilationOnBoundary() {
        final String content = TeamAutopsyPromptBuilder.buildUserContent(
                List.of(), null, List.of(),
                win(Winner.FRIENDLY_WIN), "CHRD", battle(List.of(), 1), 1);
        assertTrue(content.contains("resultSource=BATTLE_RESULTS"), content);
        assertFalse(content.contains("全歼"), content);
    }

    @Test
    void realAnnihilationStillReportsWhenBothRostersPresent() {
        // 双方 roster 齐全且对方 0 存活 → 全歼敌方
        final Battle enemyWiped = battle(bothRosters(true, false), 1);
        assertEquals("（全歼敌方）",
                FriendlyEnemyResult.annihilationSuffix(enemyWiped, 1, Winner.FRIENDLY_WIN));
        assertEquals("CHRD获胜（全歼敌方）",
                TeamEvidenceFormatter.resolveTeamResult(enemyWiped, 1, "CHRD"));
        assertEquals("CHRD获胜（全歼敌方）",
                TeamAutopsyPromptBuilder.winnerLabel(
                        win(Winner.FRIENDLY_WIN), "CHRD", enemyWiped, 1));
        // 双方 roster 齐全且本方 0 存活 → 被敌方全歼
        final Battle friendlyWiped = battle(bothRosters(false, true), 2);
        assertEquals("（被敌方全歼）",
                FriendlyEnemyResult.annihilationSuffix(friendlyWiped, 1, Winner.ENEMY_WIN));
        assertEquals("CHRD落败（被敌方全歼）",
                TeamEvidenceFormatter.resolveTeamResult(friendlyWiped, 1, "CHRD"));
        assertEquals("CHRD落败（被敌方全歼）",
                TeamAutopsyPromptBuilder.winnerLabel(
                        win(Winner.ENEMY_WIN), "CHRD", friendlyWiped, 1));
    }
}
