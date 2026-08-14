package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.processing.FriendlyEnemyResult.WinnerSource;
import com.wotb.core.processing.FriendlyEnemyResult.PointsEndReason;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class TeamAutopsyPromptBuilderTest {

    private static TeamBattleWinner win(final Winner winner) {
        return new TeamBattleWinner(
                winner, WinnerSource.BATTLE_RESULTS, false, PointsEndReason.NOT_APPLICABLE);
    }

    private static List<TeamAutopsyStats> sevenStats() {
        final List<TeamAutopsyStats> stats = new ArrayList<>();
        stats.add(stat("P1", 1001L, true, 0, false, false, false, false));
        stats.add(stat("P2", 1002L, false, 80, true, false, false, true));
        stats.add(stat("P3", 1003L, true, 0, false, true, false, true));
        stats.add(stat("P4", 1004L, false, 170, false, false, true, true));
        stats.add(stat("P5", 1005L, true, 0, false, false, false, true));
        stats.add(stat("P6", 1006L, true, 0, false, false, false, true));
        stats.add(stat("P7", 1007L, true, 0, false, false, false, true));
        return stats;
    }

    private static TeamAutopsyStats stat(final String key, final long accountId,
                                         final boolean survived, final double deathSec,
                                         final boolean earlyDeath, final boolean weakOutput,
                                         final boolean deathInWindow,
                                         final boolean settlementOnly) {
        return new TeamAutopsyStats(
                key, accountId, "nick" + key.charAt(1), "Kranvagn " + key.charAt(1),
                "重坦", "10", 1,
                1000, 800, 100, 200, 1,
                survived, deathSec,
                earlyDeath, weakOutput, deathInWindow,
                settlementOnly,
                DecodeConfidence.EXACT,
                DecodeConfidence.EXACT,
                DecodeConfidence.EXACT,
                DecodeConfidence.PARTIAL);
    }

    private static PlayerResult player(final long id, final int team, final boolean survived) {
        final PlayerResult p = new PlayerResult();
        p.accountId = id;
        p.nickname = "P" + id;
        p.team = team;
        p.survived = survived;
        return p;
    }

    /** 完整 7v7 且双方均有存活的结算阵容（rosterComplete=true；不产生全歼后缀）。 */
    private static Battle completeBothAlive() {
        final Battle b = new Battle();
        b.winnerTeam = 1;
        b.rosterComplete = true;
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            players.add(player(10_001L + i, 1, true));
        }
        for (int i = 0; i < 7; i++) {
            players.add(player(20_001L + i, 2, true));
        }
        b.players = players;
        return b;
    }

    @Test
    void userContentUsesPlayerKeysAndKeepsDeathTimelineFriendlyOnly() {
        final String content = TeamAutopsyPromptBuilder.buildUserContent(
                sevenStats(),
                new PreBattleStrategicPrior(
                        new PreBattleStrategicPrior.TeamProfile(
                                java.util.Map.of("mobility", "HIGH"),
                                List.of("s1"), List.of("w1"), List.of("p1")),
                        null, List.of(), List.of(),
                        List.of(new PreBattleStrategicPrior.StrategicHypothesis("H1", "cl", "rs"))),
                List.of(), win(Winner.ENEMY_WIN), "CHRD", completeBothAlive(), 1);
        assertTrue(content.contains("CHRD落败"));
        assertFalse(content.contains("队伍1"));
        assertFalse(content.contains("队伍2"));
        assertTrue(content.contains("本方 7 人（TEAM_A）"));
        assertTrue(content.contains("P1 昵称="));
        assertTrue(content.contains("P2 昵称="));
        assertTrue(content.contains("Kranvagn 1"));
        assertTrue(content.contains("早死=true(规则候选,精确)"));
        assertTrue(content.contains("输出不足=true(规则候选,精确)"));
        assertTrue(content.contains("窗口内阵亡=true(部分)"));
        assertTrue(content.contains("结算级代理=true"));
        assertTrue(content.contains("结算级代理=false"));
        assertTrue(content.contains("死亡时间线（后端时间线，仅本方 TEAM_A）"));
        assertTrue(content.contains("P2"));
        assertFalse(content.contains("Leopard 1"),
                "enemy death must not appear in the friendly death timeline");
        assertTrue(content.contains("请按输出契约给出 JSON"));
    }

    @Test
    void userContentUnknownDeathTimeRendersUnknownNotZeroClock() {
        final List<TeamAutopsyStats> stats = new java.util.ArrayList<>(sevenStats());
        stats.add(stat("P8", 1008L, false, 0.0, false, false, false, true));
        final String content = TeamAutopsyPromptBuilder.buildUserContent(
                stats, null, List.of(), win(Winner.ENEMY_WIN), "CHRD", completeBothAlive(), 1);

        assertTrue(content.contains("阵亡@未知"),
                "unknown death time must render as 未知 in member line: " + content);
        assertTrue(content.contains("未知 P8"),
                "unknown death time must render as 未知 in death timeline: " + content);
        assertTrue(content.contains("（时刻未知）"), content);
        assertFalse(content.contains("0分00秒"),
                "unknown death time must NOT render as 0分00秒: " + content);
    }

    @Test
    void systemPromptBansHindsightAndRequiresPlayerKeys() {
        final String settlement = TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT_SETTLEMENT_ONLY;
        assertTrue(settlement.contains("严禁事后诸葛亮"));
        assertTrue(settlement.contains("战犯"));
        assertTrue(settlement.contains("biggestLiabilities"));
        assertTrue(settlement.contains("playerKey"));
        assertTrue(settlement
                .contains("禁止用昵称或坦克名称做身份键"));
        assertTrue(settlement.contains("结算级团队剖析"));
        assertTrue(settlement.contains("没有关键窗口、没有赛前职责基线、没有逐人 Route/走位证据"));
        assertTrue(settlement.contains("置信度必须 PARTIAL 或 UNKNOWN"));
        assertTrue(settlement.contains("点数局势（结算级，强制）"),
                "autopsy must carry the settlement-level points rule");
        assertTrue(settlement.contains("禁止做「过路费不足」「攻防姿态失误」类窗口级判断"),
                "autopsy must ban window-level toll/attack-defense claims");
    }

    @Test
    void renderSectionResolvesPlayerKeysThroughRoster() {
        final TeamAutopsyResult result = new TeamAutopsyResult(
                List.of(new TeamAutopsyResult.AutopsyPlayer("P1", "HIGH", "EXACT")),
                List.of(new TeamAutopsyResult.AutopsyVerdict(
                        "P1", "关键窗口输出", List.of("e1"), "EXACT")),
                List.of(new TeamAutopsyResult.AutopsyVerdict(
                        "P2", "过早阵亡", List.of("e2"), "PARTIAL")),
                List.of("l"));
        final String section = TeamAutopsyPromptBuilder.renderSection(
                result, win(Winner.ENEMY_WIN), sevenStats(), "CHRD", completeBothAlive(), 1);
        assertTrue(section.contains("团队剖析"));
        assertTrue(section.contains("CHRD落败"));
        assertTrue(section.contains("置信度: 精确"), "EXACT must render as 精确");
        assertTrue(section.contains(": 高（"), "HIGH contribution must render as 高");
        assertTrue(section.contains("**主要战犯：**"), "战犯标题必须加粗：" + section);
        assertTrue(section.contains("**MVP：**"), "MVP 标题必须加粗：" + section);
        assertTrue(section.contains("**P2（\"nick2 / Kranvagn 2\"）**"),
                "战犯玩家名必须加粗：" + section);
        assertTrue(section.contains("**P1（\"nick1 / Kranvagn 1\"）**"),
                "MVP 玩家名必须加粗：" + section);
        assertTrue(section.contains("逐人贡献"));
        assertFalse(section.contains("限制"), "用户可见复盘不得包含限制段：" + section);
        assertFalse(section.contains("未知玩家"));
    }

    @Test
    void pointsDecidedWinnerAddsSupremacyNoteAndLabel() {
        final TeamBattleWinner points = new TeamBattleWinner(
                Winner.ENEMY_WIN, WinnerSource.POINTS_INFERENCE, true,
                PointsEndReason.TIME_EXPIRED);
        final String content = TeamAutopsyPromptBuilder.buildUserContent(
                sevenStats(), null, List.of(), points, "CHRD", completeBothAlive(), 1);
        assertTrue(content.contains("CHRD落败（时间耗尽点数判定）"));
        assertTrue(content.contains("本局为时间耗尽点数判定"));
        assertTrue(content.contains("叙述必须写「时间耗尽」"));
        assertTrue(content.contains("不要描述成敌方全歼"));

        final TeamAutopsyResult empty =
                new TeamAutopsyResult(List.of(), List.of(), List.of(), List.of());
        final String section = TeamAutopsyPromptBuilder.renderSection(
                empty, points, sevenStats(), "CHRD", completeBothAlive(), 1);
        assertTrue(section.contains("CHRD落败（时间耗尽点数判定）"));
    }

    @Test
    void reached1000WinnerAddsEarlyWinLabelAndNote() {
        final TeamBattleWinner points = new TeamBattleWinner(
                Winner.FRIENDLY_WIN, WinnerSource.BATTLE_RESULTS, true,
                PointsEndReason.REACHED_1000);
        final String content = TeamAutopsyPromptBuilder.buildUserContent(
                sevenStats(), null, List.of(), points, "CHRD", completeBothAlive(), 1);
        assertTrue(content.contains("CHRD获胜（达到 1000 分提前获胜）"));
        assertTrue(content.contains("达到 1000 分提前获胜"));
        assertTrue(content.contains("不要描述成敌方全歼"));
    }

    @Test
    void pointsDecidedUnknownReasonKeepsGenericLabel() {
        final TeamBattleWinner points = new TeamBattleWinner(
                Winner.ENEMY_WIN, WinnerSource.POINTS_INFERENCE, true,
                PointsEndReason.UNKNOWN);
        final String content = TeamAutopsyPromptBuilder.buildUserContent(
                sevenStats(), null, List.of(), points, "CHRD", completeBothAlive(), 1);
        assertTrue(content.contains("CHRD落败（点数判定）"));
        assertTrue(content.contains("本局为争霸赛点数判定"));
    }

    @Test
    void winnerLabelPlainWinnerStaysStable() {
        assertEquals("CHRD获胜", TeamAutopsyPromptBuilder.winnerLabel(
                new TeamBattleWinner(Winner.FRIENDLY_WIN, WinnerSource.BATTLE_RESULTS, false,
                        PointsEndReason.NOT_APPLICABLE), "CHRD", completeBothAlive(), 1));
        assertEquals("CHRD落败", TeamAutopsyPromptBuilder.winnerLabel(
                new TeamBattleWinner(Winner.ENEMY_WIN, WinnerSource.BATTLE_RESULTS, false,
                        PointsEndReason.NOT_APPLICABLE), "CHRD", completeBothAlive(), 1));
        assertEquals("未知", TeamAutopsyPromptBuilder.winnerLabel(
                new TeamBattleWinner(Winner.DRAW_OR_UNKNOWN, WinnerSource.UNKNOWN, false,
                        PointsEndReason.NOT_APPLICABLE), "CHRD", completeBothAlive(), 1));
        assertEquals("未知", TeamAutopsyPromptBuilder.winnerLabel(
                null, "CHRD", completeBothAlive(), 1));
    }

    @Test
    void winnerLabelsDoNotExposeRawTeamNumbers() {
        final String label = TeamAutopsyPromptBuilder.winnerLabel(
                new TeamBattleWinner(Winner.FRIENDLY_WIN, WinnerSource.BATTLE_RESULTS, false,
                        PointsEndReason.NOT_APPLICABLE), "CHRD", completeBothAlive(), 1);
        assertFalse(label.contains("TEAM_A"));
        assertFalse(label.contains("1"));
        assertFalse(label.contains("2"));
    }
}
