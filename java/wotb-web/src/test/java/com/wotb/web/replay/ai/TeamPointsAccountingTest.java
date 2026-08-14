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
 * 争霸赛击杀夺分口径（fail-closed）：40×击杀−40×阵亡（双向）、knownPointsSubtotal 只是部分可计算值、
 * 只有标准时限（随机战/官方联赛）+ 权威胜方才可证明「达到 1000 分提前获胜」且只钉死胜方 1000、
 * 失败方/时间耗尽/自定义时限的终局比分一律 UNKNOWN、无权威胜方时禁止推断胜方。
 * 口径来自真实样本：Maus 点数胜利回放（team2 占点 854/击杀 4/阵亡 4，team1 275/4/4，时长 226s，联赛）。
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

    private static Battle supremacyBattle(final double durationSec, final Integer winnerTeam,
                                          final Integer arenaBonusType) {
        final Battle b = new Battle();
        b.rosterComplete = true;
        b.durationS = durationSec;
        b.winnerTeam = winnerTeam;
        b.arenaBonusType = arenaBonusType;
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
    void killStealAccountingIsBidirectionalAndSubtotalIsPartial() {
        final Battle b = supremacyBattle(420, 2, 4);
        assertEquals(4, FriendlyEnemyResult.teamKills(b, 2));
        assertEquals(4, FriendlyEnemyResult.teamDeaths(b, 2));
        assertEquals(0, FriendlyEnemyResult.killPointsDelta(b, 2));
        assertEquals(854, FriendlyEnemyResult.knownPointsSubtotal(b, 2));
        assertEquals(275, FriendlyEnemyResult.knownPointsSubtotal(b, 1));
    }

    @Test
    void tournamentEarlyEndPinsOnlyWinnerTo1000() {
        final Battle early = supremacyBattle(226, 2, 4); // 联赛（标准时限）
        assertTrue(FriendlyEnemyResult.standardSupremacyRules(early));
        assertTrue(FriendlyEnemyResult.provableEarlyPointsWin(early));
        assertEquals(FriendlyEnemyResult.PointsEndReason.REACHED_1000,
                FriendlyEnemyResult.resolveTeamBattle(early, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, early, 2, "eval-arena");
        final String content = bw.content();
        assertTrue(content.contains("pointsEndReason=REACHED_1000"), content);
        assertTrue(content.contains("knownPointsSubtotal: team=854 opposing=275"), content);
        assertTrue(content.contains("finalScore: team=1000（达到1000分提前获胜, 规则保证） opposing=UNKNOWN"), content);
        assertFalse(content.contains("finalScore: team=854"), content);
        assertTrue(content.contains("不是终局比分"), content);
    }

    @Test
    void enemyWinEarlyEndPinsOnlyOpposing() {
        final Battle early = supremacyBattle(226, 1, 4);
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, early, 2, "eval-arena");
        assertTrue(bw.content().contains(
                "finalScore: team=UNKNOWN opposing=1000（达到1000分提前获胜, 规则保证）"), bw.content());
    }

    @Test
    void timeExpiredOutputsUnknownFinalScores() {
        final Battle late = supremacyBattle(420, 2, 4);
        assertEquals(FriendlyEnemyResult.PointsEndReason.TIME_EXPIRED,
                FriendlyEnemyResult.resolveTeamBattle(late, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, late, 2, "eval-arena");
        final String content = bw.content();
        assertTrue(content.contains("finalScore: team=UNKNOWN opposing=UNKNOWN"), content);
        assertFalse(content.contains("finalScore: team=1000"), content);
        assertFalse(content.contains("finalScore: team>=1000"), content);
    }

    @Test
    void trainingRoomEarlyEndPinsWinnerTo1000() {
        // 游戏不提供时长调整：训练房争霸赛同为标准 7 分钟/1000 分规则
        final Battle training = supremacyBattle(226, 2, 2);
        assertTrue(FriendlyEnemyResult.standardSupremacyRules(training));
        assertTrue(FriendlyEnemyResult.provableEarlyPointsWin(training));
        assertEquals(FriendlyEnemyResult.PointsEndReason.REACHED_1000,
                FriendlyEnemyResult.resolveTeamBattle(training, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, training, 2, "eval-arena");
        assertTrue(bw.content().contains(
                "finalScore: team=1000（达到1000分提前获胜, 规则保证） opposing=UNKNOWN"), bw.content());
    }

    @Test
    void unknownCategoryFailsClosedOnTimeRule() {
        // 类别未知（arenaBonusType=null）：无法证明标准规则 → 时长判据失效，结束方式与终局比分未知
        final Battle unknown = supremacyBattle(226, 2, null);
        assertFalse(FriendlyEnemyResult.standardSupremacyRules(unknown));
        assertFalse(FriendlyEnemyResult.provableEarlyPointsWin(unknown));
        assertEquals(FriendlyEnemyResult.PointsEndReason.UNKNOWN,
                FriendlyEnemyResult.resolveTeamBattle(unknown, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, unknown, 2, "eval-arena");
        final String content = bw.content();
        assertTrue(content.contains("finalScore: team=UNKNOWN opposing=UNKNOWN"), content);
        assertFalse(content.contains("finalScore: team=1000"), content);
    }

    @Test
    void missingWinnerTeamFailsClosedEvenWhenPointsConflict() {
        // 原始占点分 team1(900) > team2(700)，但击杀夺分后 team2(940) > team1(660)：方向冲突
        final Battle b = new Battle();
        b.rosterComplete = true;
        b.durationS = 226.0;
        b.arenaBonusType = 4;
        b.players = new ArrayList<>();
        b.players.add(player(1, 1, 900, 0, true));
        for (int i = 2; i <= 7; i++) {
            b.players.add(player(i, 1, 0, 0, false));
        }
        b.players.add(player(11, 2, 700, 6, true));
        for (int i = 12; i <= 17; i++) {
            b.players.add(player(i, 2, 0, 0, true));
        }
        final var w = FriendlyEnemyResult.resolveTeamBattle(b, 1);
        assertEquals(FriendlyEnemyResult.Winner.DRAW_OR_UNKNOWN, w.winner());
        assertEquals(FriendlyEnemyResult.WinnerSource.UNKNOWN, w.source());
        assertEquals("平局或未知", TeamEvidenceFormatter.resolveTeamResult(b, 1, "CHRD"));
    }

    @Test
    void subtotalLowerBoundProvesReached1000WithoutDurationClaims() {
        // 部分分下界 ≥1000 本身就是 REACHED_1000 证明（与时长/类别无关）
        final Battle training = supremacyBattle(420, 2, 2);
        training.players.get(0).victoryPointsEarned = 1043; // team2 部分分 ≥1000
        assertEquals(FriendlyEnemyResult.PointsEndReason.REACHED_1000,
                FriendlyEnemyResult.resolveTeamBattle(training, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, training, 2, "eval-arena");
        assertTrue(bw.content().contains("finalScore: team>=1000 opposing=UNKNOWN"), bw.content());
    }
}
