package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

class TeamAutopsyParserTest {

    @Test
    void parsesFencedJson() {
        final String output = """
                ```json
                {
                  "players": [
                    {"tank": "Kranvagn", "contribution": "HIGH", "confidence": "EXACT"},
                    {"tank": "T110E5", "contribution": "LOW", "confidence": "PARTIAL"}
                  ],
                  "mvps": [{"tank": "Kranvagn", "reason": "关键窗口输出", "evidence": ["e1"], "confidence": "EXACT"}],
                  "biggestLiabilities": [{"tank": "T110E5", "reason": "过早阵亡", "evidence": ["e2"], "confidence": "PARTIAL"}],
                  "limitations": ["敌方数据部分缺失"]
                }
                ```""";
        final TeamAutopsyResult result = TeamAutopsyParser.parse(output);
        assertNotNull(result);
        assertEquals(2, result.players().size());
        assertEquals("HIGH", result.players().getFirst().contribution());
        assertEquals(1, result.mvps().size());
        assertEquals("Kranvagn", result.mvps().getFirst().tank());
        assertEquals(1, result.biggestLiabilities().size());
        assertEquals("过早阵亡", result.biggestLiabilities().getFirst().reason());
        assertEquals(1, result.limitations().size());
    }

    @Test
    void capsListsAndTextLengths() {
        final List<String> playerJson = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            playerJson.add("{\"tank\":\"T" + i + "\",\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}");
        }
        final String output = "{\"players\":[" + String.join(",", playerJson) + "],"
                + "\"biggestLiabilities\":[{\"tank\":\"T\",\"reason\":\""
                + "长".repeat(300) + "\",\"evidence\":[],\"confidence\":\"PARTIAL\"}]}";
        final TeamAutopsyResult result = TeamAutopsyParser.parse(output);
        assertNotNull(result);
        assertEquals(TeamAutopsyParser.MAX_PLAYERS, result.players().size());
        assertEquals(TeamAutopsyParser.MAX_TEXT_LENGTH,
                result.biggestLiabilities().getFirst().reason().length());
    }

    @Test
    void garbageReturnsNull() {
        assertNull(TeamAutopsyParser.parse("not json"));
        assertNull(TeamAutopsyParser.parse(""));
        assertNull(TeamAutopsyParser.parse(null));
    }
}
