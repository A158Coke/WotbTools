package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.TeamGroundingFacts.AliveTransition;
import com.wotb.core.replay.evidence.TeamGroundingFacts.EvidenceFact;
import com.wotb.core.replay.evidence.TeamGroundingFacts.GroundingFacts;
import com.wotb.core.replay.timeline.BattleTimeline;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamGroundingFactsTest {

    private static Battle battle(final int perspectiveTeam) {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        battle.players = new ArrayList<>();
        final long[][] deaths = {
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
            p.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
        }
        battle.players.stream().filter(p -> p.accountId == 101L).forEach(p -> p.nickname = "__WildCat_");
        battle.players.stream().filter(p -> p.accountId == 102L).forEach(p -> p.nickname = "Azusa");
        battle.players.stream().filter(p -> p.accountId == 103L).forEach(p -> p.nickname = "FFFNuit");
        battle.players.stream().filter(p -> p.accountId == 204L).forEach(p -> p.nickname = "Fe1ix");
        return battle;
    }

    @Test
    void deathsGetStableEvidenceIdsAndTimes() {
        final GroundingFacts facts = TeamGroundingFacts.build(battle(1), (BattleTimeline) null, 1);
        final List<EvidenceFact> deaths = facts.facts().stream().filter(EvidenceFact::isDeath).toList();
        assertEquals(4, deaths.size());
        assertEquals("E101", deaths.get(0).id());
        assertEquals(112.4, deaths.get(0).timeSec(), 0.001);
        assertEquals("__WildCat_", deaths.get(0).nickname());
        assertEquals("E102", deaths.get(1).id());
        assertEquals(121.3, deaths.get(1).timeSec(), 0.001);
        assertEquals("E103", deaths.get(2).id());
        assertEquals(128.1, deaths.get(2).timeSec(), 0.001);
        assertEquals(TeamGroundingFacts.Side.ENEMY, deaths.get(2).side());
        assertEquals("E104", deaths.get(3).id());
        assertEquals(131.8, deaths.get(3).timeSec(), 0.001);
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
        assertTrue(section.startsWith("=== GROUNDING FACTS（确定性事实·每条含证据编号，供结构化输出引用；正文不得出现这些编号） ==="));
        assertTrue(section.contains("E101 [本方阵亡] 1分52秒 __WildCat_（SPHT）"), section);
        assertTrue(section.contains("E103 [对方阵亡] 2分08秒 Fe1ix（FV215b）"), section);
        assertTrue(section.contains("E104 [本方阵亡] 2分12秒 FFFNuit（SPHT）"), section);
        assertTrue(section.contains("E105 [存活变化] 7v7 → 6v7"), section);
        assertTrue(!section.contains("E1xx"));
        final String again = TeamGroundingFacts.renderGroundingSection(
                TeamGroundingFacts.build(battle(1), (BattleTimeline) null, 1));
        assertEquals(section, again);
    }

    @Test
    void formatClockMatchesChineseTimeConvention() {
        assertEquals("1分52秒", TeamGroundingFacts.formatClock(112.443));
        assertEquals("2分01秒", TeamGroundingFacts.formatClock(121.322));
        assertEquals("2分12秒", TeamGroundingFacts.formatClock(131.815));
        assertEquals("0分00秒", TeamGroundingFacts.formatClock(0));
        assertEquals("未知", TeamGroundingFacts.formatClock(Double.NaN));
    }

    @Test
    void canonicalLiveExactDeathIsAlreadyBattleRelativeAndNeverSubtractsStartRaw() {
        final Battle b = battle(1);
        final PlayerResult p = b.players.stream().filter(x -> x.accountId == 101L).findFirst().orElseThrow();
        p.deathTimeSource = DeathTimeSource.LIVE_EXACT;
        p.survivalTimeSec = 111.25;
        // Settlement can coexist but must not override LIVE_EXACT or be treated as raw packet clock.
        p.deathTimeMillis = 112_400L;

        final GroundingFacts facts = TeamGroundingFacts.build(b, 1000.0, 1);
        final EvidenceFact first = facts.facts().stream().filter(EvidenceFact::isDeath).findFirst().orElseThrow();
        assertEquals(111.25, first.timeSec(), 0.001);
        assertEquals("__WildCat_", first.nickname());
    }

    @Test
    void settlementDeathRemainsBattleRelativeEvenWhenCompatStartRawIsProvided() {
        final GroundingFacts facts = TeamGroundingFacts.build(battle(1), 1000.0, 1);
        final List<EvidenceFact> deaths = facts.facts().stream().filter(EvidenceFact::isDeath).toList();
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
