package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class TeamAutopsyPromptBuilderTest {

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
                List.of(), Winner.ENEMY_WIN);
        assertTrue(content.contains("判负（TEAM_A）"));
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
        assertTrue(content.contains("死亡时间线（权威结算，仅本方 TEAM_A）"));
        assertTrue(content.contains("P2"));
        assertFalse(content.contains("Leopard 1"),
                "enemy death must not appear in the friendly death timeline");
        assertTrue(content.contains("请按输出契约给出 JSON"));
    }

    @Test
    void systemPromptBansHindsightAndRequiresPlayerKeys() {
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("严禁事后诸葛亮"));
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("战犯"));
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("biggestLiabilities"));
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("playerKey"));
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT
                .contains("禁止用昵称或坦克名称做身份键"));
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
                result, Winner.ENEMY_WIN, sevenStats());
        assertTrue(section.contains("团队剖析"));
        assertTrue(section.contains("判负（TEAM_A）"));
        assertTrue(section.contains("主要战犯"));
        assertTrue(section.contains("P2（\"nick2 / Kranvagn 2\"）"));
        assertTrue(section.contains("P1（\"nick1 / Kranvagn 1\"）"));
        assertTrue(section.contains("逐人贡献"));
        assertFalse(section.contains("未知玩家"));
    }

    @Test
    void winnerLabelsDoNotExposeRawTeamNumbers() {
        assertEquals("判胜（TEAM_A）", TeamAutopsyPromptBuilder.winnerLabel(Winner.FRIENDLY_WIN));
        assertEquals("判负（TEAM_A）", TeamAutopsyPromptBuilder.winnerLabel(Winner.ENEMY_WIN));
        assertEquals("未知", TeamAutopsyPromptBuilder.winnerLabel(Winner.DRAW_OR_UNKNOWN));
    }
}
