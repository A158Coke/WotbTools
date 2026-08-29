package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.TeamGroundingFacts.AliveTransition;
import com.wotb.core.replay.evidence.TeamGroundingFacts.EvidenceFact;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.evidence.TeamGroundingFacts.GroundingFacts;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Grounding Facts 构建（确定性证据编号 + 渲染段）契约测试。
 * <p>不依赖 timeline（结算级事实）；真实回放回归见 TeamReviewRealReplayProbeTest。</p>
 */
class TeamGroundingFactsTest {

    private static Battle battle(final int perspectiveTeam) {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = new ArrayList<>();
        final long[][] deaths = {
                // {accountId, team, deathMillis}
                {101L, 1, 112400L},
                {102L, 1, 121300L},
                {103L, 1, 131800L},
                {204L, 2, 128100L},
        };
        for (int i = 1; i <= 7; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 100L + i;
            p.nickname = "F" + i;
            p.team = 1;
            p.tankId = 29985L;
            p.tankName = "SPHT";
            p.survived = true;
            battle.players.add(p);
        }
        for (int i = 1; i <= 7; i++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 200L + i;
            p.nickname = "E" + i;
            p.team = 2;
            p.tankId = 6225L;
            p.tankName = "FV215b";
            p.survived = true;
            battle.players.add(p);
        }
        for (final long[] d : deaths) {
            final PlayerResult p = battle.players.stream()
                    .filter(x -> x.accountId == d[0]).findFirst().orElseThrow();
            p.survived = false;
            p.deathTimeMillis = d[2];
        }
        // 命名对齐真实样本（WildCat/Azusa/FFFNuit/Fe1ix）
        battle.players.stream().filter(p -> p.accountId == 101L).forEach(p -> p.nickname = "__WildCat_");
        battle.players.stream().filter(p -> p.accountId == 102L).forEach(p -> p.nickname = "Azusa");
        battle.players.stream().filter(p -> p.accountId == 103L).forEach(p -> p.nickname = "FFFNuit");
        battle.players.stream().filter(p -> p.accountId == 204L).forEach(p -> p.nickname = "Fe1ix");
        return battle;
    }

    @Test
    void deathsGetStableEvidenceIdsAndTimes() {
        final GroundingFacts facts = TeamGroundingFacts.build(battle(1), (BattleTimeline) null, 1);
        final List<EvidenceFact> deaths = facts.facts().stream()
                .filter(EvidenceFact::isDeath)
                .toList();
        assertEquals(4, deaths.size(), "必须提取 4 条阵亡事实");
        assertEquals("E101", deaths.get(0).id());
        assertEquals(112.4, deaths.get(0).timeSec(), 0.001);
        assertEquals("__WildCat_", deaths.get(0).nickname());
        assertEquals("E102", deaths.get(1).id());
        assertEquals(121.3, deaths.get(1).timeSec(), 0.001);
        // 按时间排序：Fe1ix（128.1s 对方）排在 FFFNuit（131.8s 本方）之前
        assertEquals("E103", deaths.get(2).id());
        assertEquals(128.1, deaths.get(2).timeSec(), 0.001);
        assertEquals(TeamGroundingFacts.Side.ENEMY, deaths.get(2).side());
        assertEquals("E104", deaths.get(3).id());
        assertEquals(131.8, deaths.get(3).timeSec(), 0.001);
        // byId 索引
        assertEquals("Fe1ix", facts.byId().get("E103").nickname());
        assertEquals("FFFNuit", facts.byId().get("E104").nickname());
    }

    @Test
    void aliveTransitionsDerivedFromDeathsWithoutTimeline() {
        final GroundingFacts facts = TeamGroundingFacts.build(battle(1), (BattleTimeline) null, 1);
        final List<AliveTransition> transitions = facts.aliveTransitions();
        assertEquals(4, transitions.size());
        assertEquals(new AliveTransition(112.4, 7, 7, 6, 7), transitions.get(0));
        assertEquals(new AliveTransition(121.3, 6, 7, 5, 7), transitions.get(1));
        assertEquals(new AliveTransition(128.1, 5, 7, 5, 6), transitions.get(2));
        assertEquals(new AliveTransition(131.8, 5, 6, 4, 6), transitions.get(3));
    }

    @Test
    void renderGroundingSectionIsDeterministicAndTimeFormatted() {
        final GroundingFacts facts = TeamGroundingFacts.build(battle(1), (BattleTimeline) null, 1);
        final String section = TeamGroundingFacts.renderGroundingSection(facts);
        assertTrue(section.startsWith("=== GROUNDING FACTS（确定性事实·每条含证据编号，供结构化输出引用；正文不得出现这些编号） ==="),
                "段头必须存在: " + section);
        assertTrue(section.contains("E101 [本方阵亡] 1分52秒 __WildCat_（SPHT）"), section);
        assertTrue(section.contains("E103 [对方阵亡] 2分08秒 Fe1ix（FV215b）"), section);
        assertTrue(section.contains("E104 [本方阵亡] 2分12秒 FFFNuit（SPHT）"), section);
        assertTrue(section.contains("E105 [存活变化] 7v7 → 6v7"), section);
        assertTrue(!section.contains("E1xx"), "渲染段不得出现编号占位符");
        // 渲染一致性：两次构建渲染结果相同
        final String again = TeamGroundingFacts.renderGroundingSection(
                TeamGroundingFacts.build(battle(1), (BattleTimeline) null, 1));
        assertEquals(section, again, "渲染必须确定性");
    }

    @Test
    void formatClockMatchesChineseTimeConvention() {
        assertEquals("1分52秒", TeamGroundingFacts.formatClock(112.443));
        assertEquals("2分01秒", TeamGroundingFacts.formatClock(121.322));
        assertEquals("2分12秒", TeamGroundingFacts.formatClock(131.815));
        assertEquals("0分00秒", TeamGroundingFacts.formatClock(0));
        assertEquals("未知", TeamGroundingFacts.formatClock(Double.NaN));
    }

    /**
     *  死亡时刻时钟契约：{@code PlayerResultFormat.deathSec()} 数值域不统一——
     * deathTimeMillis（结算权威）与 legacy 估算为<b>原始时钟域</b>；显式传入 battle start raw
     * clock 时必须按 {@code raw > startRaw → raw − startRaw} 转 battle-relative。
     */
    @Test
    void deathClockIsConvertedToBattleRelativeWhenStartRawProvided() {
        final Battle rawBattle = rawClockBattle();
        final GroundingFacts facts = TeamGroundingFacts.build(rawBattle, 1000.0, 1);
        final List<EvidenceFact> deaths = facts.facts().stream()
                .filter(EvidenceFact::isDeath)
                .toList();
        // raw 1112.4s/1121.3s/1131.8s/1128.1s − startRaw 1000s → battle-relative 112.4/121.3/131.8/128.1
        assertEquals(4, deaths.size());
        assertEquals(112.4, deaths.get(0).timeSec(), 0.001);
        assertEquals("__WildCat_", deaths.get(0).nickname());
        assertEquals(121.3, deaths.get(1).timeSec(), 0.001);
        assertEquals(128.1, deaths.get(2).timeSec(), 0.001);
        assertEquals(131.8, deaths.get(3).timeSec(), 0.001);
    }

    /** 原始时钟域 fixture：deathTimeMillis 携带 battle start（1000s）之后的原始时钟。 */
    private static Battle rawClockBattle() {
        final Battle b = battle(1);
        final long[][] raw = {
                {101L, 1_112_400L},
                {102L, 1_121_300L},
                {103L, 1_131_800L},
                {204L, 1_128_100L},
        };
        for (final long[] d : raw) {
            final PlayerResult p = b.players.stream()
                    .filter(x -> x.accountId == d[0]).findFirst().orElseThrow();
            p.deathTimeMillis = d[1];
        }
        return b;
    }

    /** 无 startRaw（reconstruction 无时钟）：按 battle-relative 原样使用（契约，不猜测时钟域）。 */
    @Test
    void withoutStartRawDeathsStayAsProvided() {
        final GroundingFacts facts = TeamGroundingFacts.build(battle(1), (BattleTimeline) null, 1);
        final List<EvidenceFact> deaths = facts.facts().stream()
                .filter(EvidenceFact::isDeath)
                .toList();
        assertEquals(112.4, deaths.get(0).timeSec(), 0.001);
        assertEquals(121.3, deaths.get(1).timeSec(), 0.001);
        assertEquals(128.1, deaths.get(2).timeSec(), 0.001);
        assertEquals(131.8, deaths.get(3).timeSec(), 0.001);
    }

    @Test
    void nullBattleBuildsEmptyFacts() {
        final GroundingFacts facts = TeamGroundingFacts.build(null, (BattleTimeline) null, 1);
        assertNotNull(facts);
        assertTrue(facts.facts().isEmpty());
        assertEquals("", TeamGroundingFacts.renderGroundingSection(facts));
    }
}