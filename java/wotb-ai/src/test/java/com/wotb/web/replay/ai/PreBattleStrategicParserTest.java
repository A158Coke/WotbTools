package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class PreBattleStrategicParserTest {

    @Test
    void parsesFencedJson() {
        final String output = """
                ```json
                {
                  "teamA": {
                    "composition": {"mobility": "HIGH", "closeRangeTrading": "MEDIUM"},
                    "strengths": ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
                    "weaknesses": ["w1"],
                    "preferredPlans": ["p1"]
                  },
                  "teamB": {"composition": {"mobility": "LOW"}, "strengths": ["s2"], "weaknesses": ["w2"], "preferredPlans": []},
                  "keyMatchups": [{"area": "GRID_REGION_5", "advantage": "TEAM_A", "reason": "r"}],
                  "strategicWinConditions": [{"team": "TEAM_A", "condition": "c"}],
                  "hypotheses": [{"id": "H1", "claim": "cl", "reason": "rs"}]
                }
                ```""";
        final PreBattleStrategicPrior prior = PreBattleStrategicParser.parse(output);
        assertNotNull(prior);
        assertNotNull(prior.teamA());
        assertEquals("HIGH", prior.teamA().composition().get("mobility"));
        assertEquals(6, prior.teamA().strengths().size(), "list must be capped");
        assertEquals(1, prior.keyMatchups().size());
        assertEquals("H1", prior.hypotheses().getFirst().id());
    }

    @Test
    void plainJsonWithoutFenceWorks() {
        final PreBattleStrategicPrior prior = PreBattleStrategicParser.parse(
                "{\"teamA\":{\"strengths\":[\"x\"]},\"hypotheses\":[{\"id\":\"H1\",\"claim\":\"a\",\"reason\":\"b\"}]}");
        assertNotNull(prior);
        assertEquals("x", prior.teamA().strengths().getFirst());
    }

    @Test
    void garbageReturnsNull() {
        assertNull(PreBattleStrategicParser.parse("definitely not json"));
        assertNull(PreBattleStrategicParser.parse(""));
        assertNull(PreBattleStrategicParser.parse(null));
    }
}
