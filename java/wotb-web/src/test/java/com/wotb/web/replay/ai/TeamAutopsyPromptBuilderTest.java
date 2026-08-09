package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class TeamAutopsyPromptBuilderTest {

    private static List<TeamAutopsyStats> sevenStats() {
        final List<TeamAutopsyStats> stats = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            stats.add(new TeamAutopsyStats(
                    1000L + i, "Kranvagn " + i, "重坦", "10", 1,
                    1000 + i, 800, 100, 200, i % 3,
                    true, 0, false, false, false,
                    i != 1, DecodeConfidence.EXACT));
        }
        return stats;
    }

    private static Battle battle() {
        final Battle b = new Battle();
        b.mapName = "erlenberg";
        b.durationS = 300.0;
        b.players = new ArrayList<>();
        final PlayerResult dead = new PlayerResult();
        dead.accountId = 2001;
        dead.team = 2;
        dead.tankId = 14609;
        dead.tankName = "Leopard 1";
        dead.survived = false;
        dead.deathTimeMillis = 60_000L;
        b.players.add(dead);
        return b;
    }

    @Test
    void userContentContainsRosterFlagsPriorWindowsAndDeathTimeline() {
        final String content = TeamAutopsyPromptBuilder.buildUserContent(
                battle(), sevenStats(),
                new PreBattleStrategicPrior(
                        new PreBattleStrategicPrior.TeamProfile(
                                java.util.Map.of("mobility", "HIGH"),
                                List.of("s1"), List.of("w1"), List.of("p1")),
                        null, List.of(), List.of(),
                        List.of(new PreBattleStrategicPrior.StrategicHypothesis("H1", "cl", "rs"))),
                List.of(), Winner.ENEMY_WIN);
        assertTrue(content.contains("判负（TEAM_A / 队伍1）"));
        assertTrue(content.contains("本方 7 人"));
        assertTrue(content.contains("Kranvagn 1"));
        assertTrue(content.contains("结算级代理=true"));
        assertTrue(content.contains("结算级代理=false"));
        assertTrue(content.contains("赛前职责基线"));
        assertTrue(content.contains("H1"));
        assertTrue(content.contains("死亡时间线"));
        assertTrue(content.contains("请按输出契约给出 JSON"));
    }

    @Test
    void systemPromptBansHindsightAndRequiresVerdicts() {
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("严禁事后诸葛亮"));
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("战犯"));
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("biggestLiabilities"));
        assertTrue(TeamAutopsyPromptBuilder.AUTOPSY_SYSTEM_PROMPT.contains("JSON"));
    }

    @Test
    void renderSectionFormatsVerdicts() {
        final TeamAutopsyResult result = new TeamAutopsyResult(
                List.of(new TeamAutopsyResult.AutopsyPlayer("Kranvagn", "HIGH", "EXACT")),
                List.of(new TeamAutopsyResult.AutopsyVerdict(
                        "Kranvagn", "关键窗口输出", List.of("e1"), "EXACT")),
                List.of(new TeamAutopsyResult.AutopsyVerdict(
                        "T110E5", "过早阵亡", List.of("e2"), "PARTIAL")),
                List.of("l"));
        final String section = TeamAutopsyPromptBuilder.renderSection(result, Winner.ENEMY_WIN);
        assertTrue(section.contains("团队剖析"));
        assertTrue(section.contains("判负"));
        assertTrue(section.contains("主要战犯"));
        assertTrue(section.contains("MVP"));
        assertTrue(section.contains("逐人贡献"));
    }

    @Test
    void winnerLabelsMapCorrectly() {
        assertEquals("判胜（TEAM_A / 队伍1）", TeamAutopsyPromptBuilder.winnerLabel(Winner.FRIENDLY_WIN));
        assertEquals("判负（TEAM_A / 队伍1）", TeamAutopsyPromptBuilder.winnerLabel(Winner.ENEMY_WIN));
        assertEquals("未知", TeamAutopsyPromptBuilder.winnerLabel(Winner.DRAW_OR_UNKNOWN));
    }
}
