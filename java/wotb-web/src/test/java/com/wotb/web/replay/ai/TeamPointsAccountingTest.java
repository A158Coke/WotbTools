package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 争霸赛击杀夺分口径（#5）：40×击杀−40×阵亡（双向）、提前结束（时间未耗尽）赢队必达 1000、
 * 证据段 finalPointsComputed 与禁止冒充终局比分指令。
 * 口径来自真实样本：Maus 点数胜利回放（team2 占点 854/击杀 4/阵亡 4，team1 275/4/4，时长 226s）。
 */
class TeamPointsAccountingTest {

    private static PlayerResult player(final long id, final int team,
                                       final int earned, final int kills, final boolean survived) {
        final PlayerResult p = new PlayerResult();
        p.accountId = id;
        p.nickname = "P" + id;
        p.team = team;
        p.victoryPointsEarned = earned;
        p.kills = kills;
        p.survived = survived;
        return p;
    }

    /** Maus 样本口径的合成 battle：team2 为视角队（854/4/4），team1（275/4/4）。 */
    private static Battle supremacyBattle(final double durationSec, final Integer winnerTeam) {
        final Battle b = new Battle();
        b.rosterComplete = true;
        b.durationS = durationSec;
        b.winnerTeam = winnerTeam;
        b.arenaBonusType = 4;
        b.players = new ArrayList<>();
        b.players.add(player(1, 2, 300, 1, true));
        b.players.add(player(2, 2, 263, 1, true));
        b.players.add(player(3, 2, 211, 0, false));
        b.players.add(player(4, 2, 80, 2, true));
        b.players.add(player(5, 2, 0, 0, false));
        b.players.add(player(6, 2, 0, 0, false));
        b.players.add(player(7, 2, 0, 0, false));
        b.players.add(player(11, 1, 155, 0, false));
        b.players.add(player(12, 1, 80, 2, true));
        b.players.add(player(13, 1, 40, 1, true));
        b.players.add(player(14, 1, 0, 1, false));
        b.players.add(player(15, 1, 0, 0, false));
        b.players.add(player(16, 1, 0, 0, true));
        b.players.add(player(17, 1, 0, 0, false));
        return b;
    }

    @Test
    void killStealAccountingIsBidirectional() {
        final Battle b = supremacyBattle(420, 2);
        assertEquals(4, FriendlyEnemyResult.teamKills(b, 2));
        assertEquals(4, FriendlyEnemyResult.teamDeaths(b, 2));
        assertEquals(0, FriendlyEnemyResult.killPointsDelta(b, 2));
        assertEquals(854, FriendlyEnemyResult.finalPointsComputed(b, 2));
        assertEquals(275, FriendlyEnemyResult.finalPointsComputed(b, 1));
    }

    @Test
    void earlyEndPinsWinnerTo1000InEvidence() {
        final Battle early = supremacyBattle(226, 2);
        assertTrue(FriendlyEnemyResult.earlyPointsEnd(early));
        final FriendlyEnemyResult.TeamBattleWinner w =
                FriendlyEnemyResult.resolveTeamBattle(early, 2);
        assertEquals(FriendlyEnemyResult.PointsEndReason.REACHED_1000, w.pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, early, 2, "eval-arena");
        final String content = bw.content();
        assertTrue(content.contains("pointsEndReason=REACHED_1000"), content);
        assertTrue(content.contains("team victoryPointsEarned=854"), content);
        assertTrue(content.contains("opposing victoryPointsEarned=275"), content);
        assertTrue(content.contains("kills=4 deaths=4"), content);
        assertTrue(content.contains("finalPointsComputed: team=1000 opposing=275"), content);
        assertTrue(content.contains("赢队终局比分按规则=1000"), content);
        assertTrue(content.contains("禁止用 victoryPointsEarned 合计冒充终局比分"), content);
    }

    @Test
    void timeExpiredKeepsComputedScores() {
        final Battle late = supremacyBattle(420, 2);
        assertFalse(FriendlyEnemyResult.earlyPointsEnd(late));
        assertEquals(FriendlyEnemyResult.PointsEndReason.TIME_EXPIRED,
                FriendlyEnemyResult.resolveTeamBattle(late, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, late, 2, "eval-arena");
        final String content = bw.content();
        assertTrue(content.contains("finalPointsComputed: team=854 opposing=275"), content);
        assertFalse(content.contains("按规则=1000"), content);
    }

    @Test
    void enemyWinEarlyEndPinsOpposingScore() {
        final Battle early = supremacyBattle(226, 1);
        final var w = FriendlyEnemyResult.resolveTeamBattle(early, 2);
        assertEquals(FriendlyEnemyResult.PointsEndReason.REACHED_1000, w.pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, early, 2, "eval-arena");
        assertTrue(bw.content().contains("finalPointsComputed: team=854 opposing=1000"), bw.content());
    }
}
