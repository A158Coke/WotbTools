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
 * 争霸赛点数口径（fail-closed + 项目所有者确认的业务规则）：
 * - 420s/1000 是业务规则（arenaBonusType 只证明战斗类别，不解码出 420s/1000）；
 * - 结束方式只按「标准规则 + 时长 + 双方存活」判定，不使用任何点数公式；
 * - victoryPointsEarned 的精确定义未经证明，终局比分除规则可证明的胜方=1000 外一律 UNKNOWN；
 * - 证据只输出原始结算字段（victoryPointsEarned/Seized、kills、deaths）。
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
    void rawSettlementFactsAreExposedAsIs() {
        final Battle b = supremacyBattle(420, 2, 4);
        assertEquals(4, FriendlyEnemyResult.teamKills(b, 2));
        assertEquals(4, FriendlyEnemyResult.teamDeaths(b, 2));
        assertEquals(4, FriendlyEnemyResult.teamKills(b, 1));
        assertEquals(4, FriendlyEnemyResult.teamDeaths(b, 1));
    }

    @Test
    void earlyEndPinsOnlyWinnerTo1000ByBusinessRule() {
        final Battle early = supremacyBattle(226, 2, 4); // 已知类别：业务规则 7 分钟/1000 分
        assertTrue(FriendlyEnemyResult.standardSupremacyRules(early));
        assertTrue(FriendlyEnemyResult.provableEarlyPointsWin(early));
        assertEquals(FriendlyEnemyResult.PointsEndReason.REACHED_1000,
                FriendlyEnemyResult.resolveTeamBattle(early, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, early, 2, "eval-arena");
        final String content = bw.content();
        assertTrue(content.contains("pointsEndReason=REACHED_1000"), content);
        assertTrue(content.contains("finalScore: team=1000（达到1000分提前获胜, 业务规则） opposing=UNKNOWN"), content);
        assertTrue(content.contains("team victoryPointsEarned=854"), content);
        assertTrue(content.contains("kills=4 deaths=4"), content);
        assertFalse(content.contains("knownPointsSubtotal"), content);
        assertFalse(content.contains("finalScore: team=854"), content);
    }

    @Test
    void enemyWinEarlyEndPinsOnlyOpposing() {
        final Battle early = supremacyBattle(226, 1, 4);
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, early, 2, "eval-arena");
        assertTrue(bw.content().contains(
                "finalScore: team=UNKNOWN opposing=1000（达到1000分提前获胜, 业务规则）"), bw.content());
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
    }

    @Test
    void rawBelow1000WithKillImbalanceMustNotTriggerReached1000() {
        // 回归：raw victoryPointsEarned 均 <1000、击杀不对称（旧公式 subtotal 会 ≥1000），
        // 时长打满 7 分钟 → 必须 TIME_EXPIRED，绝不能因公式/不同组件口径得出 REACHED_1000。
        final Battle b = new Battle();
        b.rosterComplete = true;
        b.durationS = 420.0;
        b.winnerTeam = 2;
        b.arenaBonusType = 4;
        b.players = new ArrayList<>();
        b.players.add(player(1, 2, 900, 4, true)); // 旧口径 subtotal = 900 + 40×4 − 0 = 1060 ≥1000
        for (int i = 2; i <= 7; i++) {
            b.players.add(player(i, 2, 0, 0, true));
        }
        b.players.add(player(11, 1, 100, 0, false));
        for (int i = 12; i <= 17; i++) {
            b.players.add(player(i, 1, 0, 0, true));
        }
        assertEquals(FriendlyEnemyResult.PointsEndReason.TIME_EXPIRED,
                FriendlyEnemyResult.resolveTeamBattle(b, 2).pointsEndReason());
        final TeamEvidenceFormatter.BudgetWriter bw = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendCaptureAndPoints(bw, b, 2, "eval-arena");
        final String content = bw.content();
        assertTrue(content.contains("pointsEndReason=TIME_EXPIRED"), content);
        assertTrue(content.contains("finalScore: team=UNKNOWN opposing=UNKNOWN"), content);
        assertFalse(content.contains("finalScore: team=1000"), content);
    }

    @Test
    void unknownCategoryFailsClosedOnTimeRule() {
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
        // 原始占点分 team1(900) > team2(700)、击杀分布相反：禁止推断胜方
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
}
