package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

class TeamAutopsyParserTest {

    private static final Set<String> ROSTER = Set.of(
            "P1", "P2", "P3", "P4", "P5", "P6", "P7");

    @Test
    void parsesFencedJsonWithValidPlayerKeys() {
        final String output = """
                ```json
                {
                  "players": [
                    {"playerKey": "P1", "contribution": "HIGH", "confidence": "EXACT"},
                    {"playerKey": "P2", "contribution": "LOW", "confidence": "PARTIAL"}
                  ],
                  "mvps": [{"playerKey": "P1", "reason": "关键窗口输出", "evidence": ["e1"], "confidence": "EXACT"}],
                  "biggestLiabilities": [{"playerKey": "P2", "reason": "过早阵亡", "evidence": ["e2"], "confidence": "PARTIAL"}],
                  "limitations": ["敌方数据部分缺失"]
                }
                ```""";
        final TeamAutopsyResult result = TeamAutopsyParser.parse(output, ROSTER, Winner.ENEMY_WIN);
        assertNotNull(result);
        assertEquals(2, result.players().size());
        assertEquals("HIGH", result.players().getFirst().contribution());
        assertEquals(1, result.mvps().size());
        assertEquals("P1", result.mvps().getFirst().playerKey());
        assertEquals(1, result.biggestLiabilities().size());
        assertEquals("P2", result.biggestLiabilities().getFirst().playerKey());
        assertEquals(1, result.limitations().size());
    }

    @Test
    void capsListsAndTextLengths() {
        final List<String> playerJson = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            playerJson.add("{\"playerKey\":\"P" + (i % 7 + 1)
                    + "\",\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}");
        }
        final String output = "{\"players\":[" + String.join(",", playerJson) + "],"
                + "\"biggestLiabilities\":[{\"playerKey\":\"P1\",\"reason\":\""
                + "长".repeat(300) + "\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        final TeamAutopsyResult result = TeamAutopsyParser.parse(output, ROSTER, Winner.ENEMY_WIN);
        assertNotNull(result);
        assertEquals(TeamAutopsyParser.MAX_PLAYERS, result.players().size());
        assertEquals(TeamAutopsyParser.MAX_TEXT_LENGTH,
                result.biggestLiabilities().getFirst().reason().length());
    }

    @Test
    void rejectsUnknownOrDuplicatePlayerKeys() {
        final String unknown = "{\"players\":[{\"playerKey\":\"P9\",\"contribution\":\"HIGH\","
                + "\"confidence\":\"EXACT\"}],\"biggestLiabilities\":[{\"playerKey\":\"P9\","
                + "\"reason\":\"r\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(unknown, ROSTER, Winner.ENEMY_WIN));

        final String duplicate = "{\"players\":[{\"playerKey\":\"P1\",\"contribution\":\"HIGH\","
                + "\"confidence\":\"EXACT\"},{\"playerKey\":\"P1\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"}],\"biggestLiabilities\":[{\"playerKey\":\"P1\","
                + "\"reason\":\"r\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(duplicate, ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void rejectsInvalidEnumsAndMissingEvidence() {
        final String badContribution = "{\"players\":[{\"playerKey\":\"P1\","
                + "\"contribution\":\"EXCELLENT\",\"confidence\":\"EXACT\"}],"
                + "\"biggestLiabilities\":[{\"playerKey\":\"P1\",\"reason\":\"r\","
                + "\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(badContribution, ROSTER, Winner.ENEMY_WIN));

        final String badConfidence = "{\"players\":[{\"playerKey\":\"P1\","
                + "\"contribution\":\"HIGH\",\"confidence\":\"CERTAIN\"}],"
                + "\"biggestLiabilities\":[{\"playerKey\":\"P1\",\"reason\":\"r\","
                + "\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(badConfidence, ROSTER, Winner.ENEMY_WIN));

        final String noEvidence = "{\"players\":[{\"playerKey\":\"P1\","
                + "\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}],"
                + "\"biggestLiabilities\":[{\"playerKey\":\"P1\",\"reason\":\"r\","
                + "\"evidence\":[],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(noEvidence, ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void rejectsEmptyObjectAndMissingRequiredVerdicts() {
        assertNull(TeamAutopsyParser.parse("{}", ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse(
                "{\"players\":[],\"biggestLiabilities\":[{\"playerKey\":\"P1\","
                        + "\"reason\":\"r\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}",
                ROSTER, Winner.ENEMY_WIN));

        final String winWithoutMvp = "{\"players\":[{\"playerKey\":\"P1\","
                + "\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}],\"mvps\":[],"
                + "\"biggestLiabilities\":[{\"playerKey\":\"P1\",\"reason\":\"r\","
                + "\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(winWithoutMvp, ROSTER, Winner.FRIENDLY_WIN));

        final String lossWithoutLiability = "{\"players\":[{\"playerKey\":\"P1\","
                + "\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}],"
                + "\"mvps\":[{\"playerKey\":\"P1\",\"reason\":\"r\","
                + "\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}],\"biggestLiabilities\":[]}";
        assertNull(TeamAutopsyParser.parse(lossWithoutLiability, ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void garbageReturnsNull() {
        assertNull(TeamAutopsyParser.parse("not json", ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse("", ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse(null, ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse("{\"players\":[]}", ROSTER, Winner.DRAW_OR_UNKNOWN));
    }
}
