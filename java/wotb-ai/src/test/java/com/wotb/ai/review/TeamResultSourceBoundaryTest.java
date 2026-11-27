package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult.PointsEndReason;
import com.wotb.core.replay.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.processing.FriendlyEnemyResult.WinnerSource;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    @Test
    void annihilationSuffixFailClosedOnBoundaryInputs() {
        assertTrue(FriendlyEnemyResult.annihilationSuffix(null, 1, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(null, 1), 1, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(List.of(), 1), 1, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(friendlyRoster(false), 1), 1, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(enemyRoster(false), 2), 1, Winner.ENEMY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(bothRosters(false, true), 1), 0, Winner.FRIENDLY_WIN).isEmpty());
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                battle(bothRosters(false, true), 1), 3, Winner.FRIENDLY_WIN).isEmpty());
    }

    @Test
    void teamResultLineNeverReportsAnnihilationOnBoundaryInputs() {
        assertFalse(TeamOutcomeFormatter.resolveTeamResult(null, 1, "CHRD").contains("全歼"));
        assertFalse(TeamOutcomeFormatter.resolveTeamResult(
                battle(null, 1), 1, "CHRD").contains("全歼"));
        assertFalse(TeamOutcomeFormatter.resolveTeamResult(
                battle(List.of(), 1), 1, "CHRD").contains("全歼"));
        assertFalse(TeamOutcomeFormatter.resolveTeamResult(
                battle(friendlyRoster(false), 1), 1, "CHRD").contains("全歼"));
        assertFalse(TeamOutcomeFormatter.resolveTeamResult(
                battle(enemyRoster(false), 2), 1, "CHRD").contains("全歼"));
        assertFalse(TeamOutcomeFormatter.resolveTeamResult(
                battle(bothRosters(false, true), 1), 0, "CHRD").contains("全歼"));
        assertFalse(TeamOutcomeFormatter.resolveTeamResult(
                battle(bothRosters(false, true), 1), 3, "CHRD").contains("全歼"));
    }

    @Test
    void realAnnihilationStillReportsWhenBothRostersPresent() {
        final Battle enemyWiped = completeBattle(bothRosters(true, false), 1);
        assertEquals("（全歼敌方）",
                FriendlyEnemyResult.annihilationSuffix(enemyWiped, 1, Winner.FRIENDLY_WIN));
        assertEquals("CHRD获胜（全歼敌方）",
                TeamOutcomeFormatter.resolveTeamResult(enemyWiped, 1, "CHRD"));
        final Battle friendlyWiped = completeBattle(bothRosters(false, true), 2);
        assertEquals("（被敌方全歼）",
                FriendlyEnemyResult.annihilationSuffix(friendlyWiped, 1, Winner.ENEMY_WIN));
        assertEquals("CHRD落败（被敌方全歼）",
                TeamOutcomeFormatter.resolveTeamResult(friendlyWiped, 1, "CHRD"));
    }

    @Test
    void partialEnemyRecordsNeverReportAnnihilation() {
        final List<PlayerResult> players = new ArrayList<>(friendlyRoster(true));
        players.add(player(20_001L, 2, false));
        final Battle withWinner = battle(players, 1);
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                withWinner, 1, Winner.FRIENDLY_WIN).isEmpty());
        assertEquals(Winner.FRIENDLY_WIN, FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).winner());
        assertEquals(WinnerSource.BATTLE_RESULTS,
                FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).source());
        assertEquals("CHRD获胜", TeamOutcomeFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
        final Battle noWinner = battle(players, null);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertEquals("平局或未知", TeamOutcomeFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
    }

    @Test
    void partialFriendlyRecordsNeverReportAnnihilation() {
        final List<PlayerResult> players = new ArrayList<>(enemyRoster(true));
        players.add(player(10_001L, 1, false));
        final Battle withWinner = battle(players, 2);
        assertTrue(FriendlyEnemyResult.annihilationSuffix(
                withWinner, 1, Winner.ENEMY_WIN).isEmpty());
        assertEquals(Winner.ENEMY_WIN, FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).winner());
        assertEquals(WinnerSource.BATTLE_RESULTS,
                FriendlyEnemyResult.resolveTeamBattle(withWinner, 1).source());
        assertEquals("CHRD落败", TeamOutcomeFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
        final Battle noWinner = battle(players, null);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertEquals("平局或未知", TeamOutcomeFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
    }

    @Test
    void legalNonSevenVsSevenCompleteRosterStillWorks() {
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
                TeamOutcomeFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
        final Battle noWinner = completeBattle(players, null);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.FRIENDLY_WIN, resolved.winner());
        assertEquals(WinnerSource.SURVIVOR_SETTLEMENT, resolved.source());
        assertEquals("CHRD获胜（全歼敌方）",
                TeamOutcomeFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
    }

    @Test
    void incompleteRoster_winnerMissing_neverPointsInference() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 300;
        players.get(7).victoryPointsEarned = 700;
        final Battle noWinner = battle(players, null);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(noWinner, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertNotEquals(WinnerSource.POINTS_INFERENCE, resolved.source());
        assertEquals(PointsEndReason.UNKNOWN, resolved.pointsEndReason());
        assertEquals("平局或未知", TeamOutcomeFormatter.resolveTeamResult(noWinner, 1, "CHRD"));
    }

    @Test
    void incompleteRoster_winnerPresent_pointsEndReasonUnknown() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 300;
        players.get(7).victoryPointsEarned = 700;
        final Battle withWinner = battle(players, 1);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(withWinner, 1);
        assertEquals(Winner.FRIENDLY_WIN, resolved.winner());
        assertEquals(WinnerSource.BATTLE_RESULTS, resolved.source());
        assertTrue(resolved.pointsDecided());
        assertEquals(PointsEndReason.UNKNOWN, resolved.pointsEndReason());
        assertEquals("CHRD获胜（点数判定）",
                TeamOutcomeFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
    }

    @Test
    void incompleteRoster_winnerPresent_partialReached1000StillUnknown() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 1043;
        players.get(7).victoryPointsEarned = 100;
        final Battle withWinner = battle(players, 1);
        final var resolved = FriendlyEnemyResult.resolveTeamBattle(withWinner, 1);
        assertEquals(PointsEndReason.UNKNOWN, resolved.pointsEndReason());
        assertEquals("CHRD获胜（点数判定）",
                TeamOutcomeFormatter.resolveTeamResult(withWinner, 1, "CHRD"));
    }

    @Test
    void captureAndPointsSuppressesPartialTotalsWhenRosterIncomplete() {
        final List<PlayerResult> players = bothRosters(true, true);
        players.get(0).victoryPointsEarned = 1043;
        players.get(7).victoryPointsEarned = 100;
        final Battle incomplete = battle(players, 1);
        final TeamPromptBudgetWriter w = new TeamPromptBudgetWriter();
        TeamOutcomeFormatter.appendCaptureAndPoints(w, incomplete, 1, "eval-arena");
        final String content = w.content();
        assertTrue(content.contains("SETTLEMENT_ROSTER_INCOMPLETE=true"), content);
        assertTrue(content.contains("pointsTotalsUnavailable=true"), content);
        assertTrue(content.contains("team victoryPointsEarned=UNKNOWN victoryPointsSeized=UNKNOWN"),
                content);
        assertTrue(content.contains("opposing victoryPointsEarned=UNKNOWN"), content);
        assertFalse(content.contains("victoryPointsEarned=1043"), content);
        assertFalse(content.contains("victoryPointsEarned=100"), content);
        final Battle complete = completeBattle(players, 1);
        final TeamPromptBudgetWriter w2 = new TeamPromptBudgetWriter();
        TeamOutcomeFormatter.appendCaptureAndPoints(w2, complete, 1, "eval-arena");
        final String completeContent = w2.content();
        assertTrue(completeContent.contains("team victoryPointsEarned=1043"), completeContent);
        assertFalse(completeContent.contains("SETTLEMENT_ROSTER_INCOMPLETE"), completeContent);
    }

    @Test
    void completeRosterPointsWinsFailClosedWithoutAuthoritativeWinner() {
        final List<PlayerResult> timeExpired = bothRosters(true, true);
        timeExpired.get(0).victoryPointsEarned = 400;
        timeExpired.get(7).victoryPointsEarned = 100;
        final Battle timeExpiredBattle = completeBattle(timeExpired, null);
        timeExpiredBattle.durationS = 420.0;
        var resolved = FriendlyEnemyResult.resolveTeamBattle(timeExpiredBattle, 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertEquals(PointsEndReason.TIME_EXPIRED, resolved.pointsEndReason());
        assertEquals("平局或未知",
                TeamOutcomeFormatter.resolveTeamResult(timeExpiredBattle, 1, "CHRD"));

        final List<PlayerResult> reached = bothRosters(true, true);
        reached.get(0).victoryPointsEarned = 1043;
        reached.get(7).victoryPointsEarned = 100;
        resolved = FriendlyEnemyResult.resolveTeamBattle(completeBattle(reached, null), 1);
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertEquals(PointsEndReason.REACHED_1000, resolved.pointsEndReason());
        assertEquals("平局或未知",
                TeamOutcomeFormatter.resolveTeamResult(
                        completeBattle(reached, null), 1, "CHRD"));

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
        assertEquals(Winner.DRAW_OR_UNKNOWN, resolved.winner());
        assertEquals(WinnerSource.UNKNOWN, resolved.source());
        assertEquals(PointsEndReason.TIME_EXPIRED, resolved.pointsEndReason());
    }
}
