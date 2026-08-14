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
import static org.junit.jupiter.api.Assertions.assertNotEquals;
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

    /** 结算阵容完整（rosterComplete=true）的 battle；players 由调用方给出。 */
    private static Battle completeBattle(final List<PlayerResult> players, final Integer winnerTeam) {
        final Battle b = battle(players, winnerTeam);
        b.rosterComplete = true;
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
        final Battle enemyWiped = completeBattle(bothRosters(true, false), 1);
        assertEquals("（全歼敌方）",
                FriendlyEnemyResult.annihilationSuffix(enemyWiped, 1, Winner.FRIENDLY_WIN));
        assertEquals("CHRD获胜（全歼敌方）",
                TeamEvidenceFormatter.resolveTeamResult(enemyWiped, 1, "CHRD"));
        assertEquals("CHRD获胜（全歼敌方）",
                TeamAutopsyPromptBuilder.winnerLabel(
                        win(Winner.FRIENDLY_WIN), "CHRD", enemyWiped, 1));
        // 双方 roster 齐全且本方 0 存活 → 被敌方全歼
        final Battle friendlyWiped = completeBattle(bothRosters(false, true), 2);
        assertEquals("（被敌方全歼）",
                FriendlyEnemyResult.annihilationSuffix(friendlyWiped, 1, Winner.ENEMY_WIN));
        assertEquals("CHRD落败（被敌方全歼）",
                TeamEvidenceFormatter.resolveTeamResult(friendlyWiped, 1, "CHRD"));
        assertEquals("CHRD落败（被敌方全歼）",
                TeamAutopsyPromptBuilder.winnerLabel(
                        win(Winner.ENEMY_WIN), "CHRD", friendlyWiped, 1));
    }

    @Test
    void partialEnemyRecordsNeverReportAnnihilation() {
        // 7 名我方存活 + 仅 1 名已阵亡敌方记录（其余敌方结算记录缺失，rosterComplete=false）
        final List<PlayerResult> players = new ArrayList<>(friendlyRoster(true));
        players.add(player(20_001L, 2, false));
        // winnerTeam 存在：BATTLE_RESULTS 权威胜方可用，但不得输出全歼
        final Battle withWinner = battle(players, 1);
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                withWinner, 1, Winner.FRIENDLY_WIN).isEmpty());
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).winner());
        assertEquals(WinnerSource.BATTLE_RESULTS,
                FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).source());
        assertEquals("CHRD获胜", TeamEvidenceFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
        assertEquals("CHRD获胜", TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", withWinner, 1));
        // winnerTeam 缺失：不得推导为 SURVIVOR_SETTLEMENT 胜利
        final Battle noWinner = battle(players, null);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertEquals("平局或未知", TeamEvidenceFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
        assertEquals("CHRD获胜", TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", noWinner, 1));
    }

    @Test
    void partialFriendlyRecordsNeverReportAnnihilation() {
        // 7 名敌方存活 + 仅 1 名已阵亡本方记录（其余本方结算记录缺失，rosterComplete=false）
        final List<PlayerResult> players = new ArrayList<>(enemyRoster(true));
        players.add(player(10_001L, 1, false));
        // winnerTeam 存在：BATTLE_RESULTS 权威胜方可用，但不得输出被敌方全歼
        final Battle withWinner = battle(players, 2);
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                withWinner, 1, Winner.ENEMY_WIN).isEmpty());
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).winner());
        assertEquals(WinnerSource.BATTLE_RESULTS,
                FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).source());
        assertEquals("CHRD落败", TeamEvidenceFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
        assertEquals("CHRD落败", TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.ENEMY_WIN), "CHRD", withWinner, 1));
        // winnerTeam 缺失：不得推导为 SURVIVOR_SETTLEMENT 落败
        final Battle noWinner = battle(players, null);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertEquals("平局或未知", TeamEvidenceFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
    }

    @Test
    void legalNonSevenVsSevenCompleteRosterStillWorks() {
        // 完整 3v3 训练房（非 7v7）：名册完整时全歼与 SURVIVOR_SETTLEMENT 仍成立
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            players.add(player(10_001L + i, 1, true));
        }
        for (int i = 0; i < 3; i++) {
            players.add(player(20_001L + i, 2, false));
        }
        final Battle withWinner = completeBattle(players, 1);
        assertEquals("（全歼敌方）",
                FriendlyEnemyResult.annihilationSuffix(withWinner, 1, Winner.FRIENDLY_WIN));
        assertEquals("CHRD获胜（全歼敌方）",
                TeamEvidenceFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
        assertEquals("CHRD获胜（全歼敌方）", TeamAutopsyPromptBuilder.winnerLabel(
                win(Winner.FRIENDLY_WIN), "CHRD", withWinner, 1));
        // winnerTeam 缺失且完整 3v3：仍可推导 SURVIVOR_SETTLEMENT
        final Battle noWinner = completeBattle(players, null);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.FRIENDLY_WIN, resolved.winner());
        assertEquals(WinnerSource.SURVIVOR_SETTLEMENT, resolved.source());
        assertEquals("CHRD获胜（全歼敌方）",
                TeamEvidenceFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
    }

    @Test
    void incompleteRoster_winnerMissing_neverPointsInference() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 300;
        players.get(7).victoryPointsEarned = 700; // 部分点数不同
        final Battle noWinner = battle(players, null); // rosterComplete=false
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertNotEquals(WinnerSource.POINTS_INFERENCE, resolved.source());
        assertEquals(PointsEndReason.UNKNOWN, resolved.pointsEndReason());
        assertEquals("平局或未知", TeamEvidenceFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
    }

    @Test
    void incompleteRoster_winnerPresent_pointsEndReasonUnknown() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 300;
        players.get(7).victoryPointsEarned = 700; // 双方均 <1000，看似 TIME_EXPIRED
        final Battle withWinner = battle(players, 1); // rosterComplete=false
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(withWinner, 1);
        assertEquals(Winner.FRIENDLY_WIN, resolved.winner());
        assertEquals(WinnerSource.BATTLE_RESULTS, resolved.source());
        assertTrue(resolved.pointsDecided());
        assertEquals(PointsEndReason.UNKNOWN, resolved.pointsEndReason());
        assertEquals("CHRD获胜（点数判定）",
                TeamEvidenceFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
        final TeamBattleWinner unknownPoints = new TeamBattleWinner(
                Winner.FRIENDLY_WIN, WinnerSource.BATTLE_RESULTS, true, PointsEndReason.UNKNOWN);
        assertEquals("CHRD获胜（点数判定）",
                TeamAutopsyPromptBuilder.winnerLabel(unknownPoints, "CHRD", withWinner, 1));
    }

    @Test
    void incompleteRoster_winnerPresent_partialReached1000StillUnknown() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 1043; // 看似 REACHED_1000
        players.get(7).victoryPointsEarned = 100;
        final Battle withWinner = battle(players, 1); // rosterComplete=false
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(withWinner, 1);
        assertEquals(PointsEndReason.UNKNOWN, resolved.pointsEndReason());
        assertEquals("CHRD获胜（点数判定）",
                TeamEvidenceFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
    }

    @Test
    void captureAndPointsSuppressesPartialTotalsWhenRosterIncomplete() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 1043;
        players.get(7).victoryPointsEarned = 100;
        final Battle incomplete = battle(players, 1); // rosterComplete=false
        final TeamEvidenceFormatter.BudgetWriter w = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(w, incomplete, 1, "eval-arena");
        final String content = w.content();
        assertTrue(content.contains("SETTLEMENT_ROSTER_INCOMPLETE=true"), content);
        assertTrue(content.contains("pointsTotalsUnavailable=true"), content);
        assertTrue(content.contains("team victoryPointsEarned=UNKNOWN victoryPointsSeized=UNKNOWN"),
                content);
        assertTrue(content.contains("opposing victoryPointsEarned=UNKNOWN"), content);
        assertFalse(content.contains("victoryPointsEarned=1043"), content);
        assertFalse(content.contains("victoryPointsEarned=100"), content);
        // 完整阵容对照：输出真实总量且无标记
        final Battle complete = completeBattle(players, 1);
        final TeamEvidenceFormatter.BudgetWriter w2 = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(w2, complete, 1, "eval-arena");
        final String completeContent = w2.content();
        assertTrue(completeContent.contains("team victoryPointsEarned=1043"), completeContent);
        assertFalse(completeContent.contains("SETTLEMENT_ROSTER_INCOMPLETE"), completeContent);
    }

    @Test
    void completeRosterPointsWinsStillWork() {
        // 完整 7v7：winnerTeam=null、双方存活 → POINTS_INFERENCE + TIME_EXPIRED（时长打满 7 分钟）
        final List<PlayerResult> timeExpired = bothRosters(true, true);
        timeExpired.get(0).victoryPointsEarned = 400;
        timeExpired.get(7).victoryPointsEarned = 100;
        final Battle timeExpiredBattle = completeBattle(timeExpired, null);
        timeExpiredBattle.durationS = 420.0;
        var resolved = FriendlyEnemyResult.resolveTeamBattle(timeExpiredBattle, 1);
        assertEquals(Winner.FRIENDLY_WIN, resolved.winner());
        assertEquals(WinnerSource.POINTS_INFERENCE, resolved.source());
        assertEquals(PointsEndReason.TIME_EXPIRED, resolved.pointsEndReason());
        assertEquals("CHRD获胜（时间耗尽点数判定）",
                TeamEvidenceFormatter.resolveTeamResult(timeExpiredBattle, 1, "CHRD"));

        // 完整 7v7：任一方 ≥1000 → REACHED_1000
        final List<PlayerResult> reached = bothRosters(true, true);
        reached.get(0).victoryPointsEarned = 1043;
        reached.get(7).victoryPointsEarned = 100;
        resolved = FriendlyEnemyResult.resolveTeamBattle(completeBattle(reached, null), 1);
        assertEquals(WinnerSource.POINTS_INFERENCE, resolved.source());
        assertEquals(PointsEndReason.REACHED_1000, resolved.pointsEndReason());
        assertEquals("CHRD获胜（达到 1000 分提前获胜）",
                TeamEvidenceFormatter.resolveTeamResult(
                        completeBattle(reached, null), 1, "CHRD"));

        // 合法非 7v7（完整 3v3）：点数胜负同样工作
        final List<PlayerResult> threeVThree = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            threeVThree.add(player(10_001L + i, 1, true));
        }
        for (int i = 0; i < 3; i++) {
            threeVThree.add(player(20_001L + i, 2, true));
        }
        threeVThree.get(0).victoryPointsEarned = 300;
        threeVThree.get(3).victoryPointsEarned = 700;
        final Battle threeVThreeBattle = completeBattle(threeVThree, null);
        threeVThreeBattle.durationS = 420.0;
        resolved = FriendlyEnemyResult.resolveTeamBattle(threeVThreeBattle, 1);
        assertEquals(Winner.ENEMY_WIN, resolved.winner());
        assertEquals(WinnerSource.POINTS_INFERENCE, resolved.source());
        assertEquals(PointsEndReason.TIME_EXPIRED, resolved.pointsEndReason());
    }
}
