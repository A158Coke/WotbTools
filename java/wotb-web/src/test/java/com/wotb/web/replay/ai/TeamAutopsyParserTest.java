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

    private static String allPlayers(final String contribution, final String confidence) {
        final StringBuilder sb = new StringBuilder("\"players\":[");
        for (int i = 1; i <= 7; i++) {
            if (i > 1) {
                sb.append(',');
            }
            sb.append("{\"playerKey\":\"P").append(i)
                    .append("\",\"contribution\":\"").append(contribution)
                    .append("\",\"confidence\":\"").append(confidence).append("\"}");
        }
        return sb.append(']').toString();
    }

    /** 完整 7 人数组（P1 用自定义 contribution/confidence，P2..P7 用 HIGH/EXACT）。 */
    private static String playersWithCustomP1(final String contribution,
                                              final String confidence) {
        final StringBuilder sb = new StringBuilder("\"players\":[{\"playerKey\":\"P1\"")
                .append(",\"contribution\":\"").append(contribution)
                .append("\",\"confidence\":\"").append(confidence).append("\"}");
        for (int i = 2; i <= 7; i++) {
            sb.append(",{\"playerKey\":\"P").append(i)
                    .append("\",\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}");
        }
        return sb.append(']').toString();
    }

    private static String verdictJson(final String key, final String reason,
                                      final String evidence, final String confidence) {
        return "{\"playerKey\":\"" + key + "\",\"reason\":\"" + reason
                + "\",\"evidence\":[\"" + evidence + "\"],\"confidence\":\"" + confidence + "\"}";
    }

    private static String fullBody(final String playersJson, final String extra) {
        return "{" + playersJson + "," + extra + "}";
    }

    private static String lossBody(final String playersJson, final String liabilities) {
        return fullBody(playersJson, "\"biggestLiabilities\":[" + liabilities + "]");
    }

    @Test
    void parsesFencedJsonWithValidPlayerKeys() {
        final String output = """
                ```json
                {
                  "players": [
                    {"playerKey": "P1", "contribution": "HIGH", "confidence": "EXACT"},
                    {"playerKey": "P2", "contribution": "LOW", "confidence": "PARTIAL"},
                    {"playerKey": "P3", "contribution": "MEDIUM", "confidence": "INFERRED"},
                    {"playerKey": "P4", "contribution": "UNKNOWN", "confidence": "UNKNOWN"},
                    {"playerKey": "P5", "contribution": "HIGH", "confidence": "EXACT"},
                    {"playerKey": "P6", "contribution": "MEDIUM", "confidence": "PARTIAL"},
                    {"playerKey": "P7", "contribution": "LOW", "confidence": "INFERRED"}
                  ],
                  "mvps": [{"playerKey": "P1", "reason": "关键窗口输出", "evidence": ["e1"], "confidence": "EXACT"}],
                  "biggestLiabilities": [{"playerKey": "P2", "reason": "过早阵亡", "evidence": ["e2"], "confidence": "PARTIAL"}],
                  "limitations": ["敌方数据部分缺失"]
                }
                ```""";
        final TeamAutopsyResult result = TeamAutopsyParser.parse(output, ROSTER, Winner.ENEMY_WIN);
        assertNotNull(result);
        assertEquals(7, result.players().size());
        assertEquals("HIGH", result.players().getFirst().contribution());
        assertEquals(1, result.mvps().size());
        assertEquals("P1", result.mvps().getFirst().playerKey());
        assertEquals(1, result.biggestLiabilities().size());
        assertEquals("P2", result.biggestLiabilities().getFirst().playerKey());
        assertEquals(1, result.limitations().size());
    }

    @Test
    void capsListsAndTextLengths() {
        final String output = lossBody(
                allPlayers("HIGH", "EXACT"),
                "{\"playerKey\":\"P1\",\"reason\":\"" + "长".repeat(300)
                        + "\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}");
        final TeamAutopsyResult result = TeamAutopsyParser.parse(output, ROSTER, Winner.ENEMY_WIN);
        assertNotNull(result);
        assertEquals(7, result.players().size());
        assertEquals(TeamAutopsyParser.MAX_TEXT_LENGTH,
                result.biggestLiabilities().getFirst().reason().length());
    }

    @Test
    void rejectsUnknownOrDuplicatePlayerKeys() {
        final String unknown = "{\"players\":[{\"playerKey\":\"P9\",\"contribution\":\"HIGH\","
                + "\"confidence\":\"EXACT\"},{\"playerKey\":\"P2\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P3\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P4\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P5\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P6\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P7\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"}],\"biggestLiabilities\":[{\"playerKey\":\"P9\","
                + "\"reason\":\"r\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(unknown, ROSTER, Winner.ENEMY_WIN));

        final String duplicate = "{\"players\":[{\"playerKey\":\"P1\",\"contribution\":\"HIGH\","
                + "\"confidence\":\"EXACT\"},{\"playerKey\":\"P1\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P3\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P4\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P5\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P6\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"},{\"playerKey\":\"P7\",\"contribution\":\"LOW\","
                + "\"confidence\":\"PARTIAL\"}],\"biggestLiabilities\":[{\"playerKey\":\"P1\","
                + "\"reason\":\"r\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}]}";
        assertNull(TeamAutopsyParser.parse(duplicate, ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void rejectsInvalidEnumsAndMissingEvidence() {
        final String badContribution = lossBody(
                playersWithCustomP1("EXCELLENT", "EXACT"),
                verdictJson("P1", "r", "e", "PARTIAL"));
        assertNull(TeamAutopsyParser.parse(badContribution, ROSTER, Winner.ENEMY_WIN));

        final String badConfidence = lossBody(
                allPlayers("HIGH", "CERTAIN"),
                verdictJson("P1", "r", "e", "PARTIAL"));
        assertNull(TeamAutopsyParser.parse(badConfidence, ROSTER, Winner.ENEMY_WIN));

        final String noEvidence = lossBody(
                allPlayers("HIGH", "EXACT"),
                "{\"playerKey\":\"P1\",\"reason\":\"r\",\"evidence\":[],\"confidence\":\"PARTIAL\"}");
        assertNull(TeamAutopsyParser.parse(noEvidence, ROSTER, Winner.ENEMY_WIN));

        final String noReason = lossBody(
                allPlayers("HIGH", "EXACT"),
                "{\"playerKey\":\"P1\",\"reason\":\" \",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}");
        assertNull(TeamAutopsyParser.parse(noReason, ROSTER, Winner.ENEMY_WIN));

        final String duplicateVerdictKey = lossBody(
                allPlayers("HIGH", "EXACT"),
                "{\"playerKey\":\"P1\",\"reason\":\"r1\",\"evidence\":[\"e1\"],\"confidence\":\"PARTIAL\"},"
                        + "{\"playerKey\":\"P1\",\"reason\":\"r2\",\"evidence\":[\"e2\"],\"confidence\":\"PARTIAL\"}");
        assertNull(TeamAutopsyParser.parse(duplicateVerdictKey, ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void rejectsEmptyObjectAndMissingRequiredVerdicts() {
        assertNull(TeamAutopsyParser.parse("{}", ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse(
                lossBody("\"players\":[]",
                        "{\"playerKey\":\"P1\",\"reason\":\"r\",\"evidence\":[\"e\"],\"confidence\":\"PARTIAL\"}"),
                ROSTER, Winner.ENEMY_WIN));

        final String winWithoutMvp = fullBody(allPlayers("HIGH", "EXACT"),
                "\"mvps\":[],\"biggestLiabilities\":[" + verdictJson("P1", "r", "e", "PARTIAL") + "]");
        assertNull(TeamAutopsyParser.parse(winWithoutMvp, ROSTER, Winner.FRIENDLY_WIN));

        final String lossWithoutLiability = fullBody(allPlayers("HIGH", "EXACT"),
                "\"mvps\":[" + verdictJson("P1", "r", "e", "PARTIAL") + "],\"biggestLiabilities\":[]");
        assertNull(TeamAutopsyParser.parse(lossWithoutLiability, ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void rejectsPartialOrExtraPlayerCoverage() {
        // 1~6 名玩家：缺失 roster 成员 → 拒绝
        for (int count = 1; count <= 6; count++) {
            final StringBuilder sb = new StringBuilder("\"players\":[");
            for (int i = 1; i <= count; i++) {
                if (i > 1) {
                    sb.append(',');
                }
                sb.append("{\"playerKey\":\"P").append(i)
                        .append("\",\"contribution\":\"HIGH\",\"confidence\":\"EXACT\"}");
            }
            final String body = lossBody(sb.append(']').toString(),
                    verdictJson("P1", "r", "e", "PARTIAL"));
            assertNull(TeamAutopsyParser.parse(body, ROSTER, Winner.ENEMY_WIN),
                    count + " players must be rejected (roster is 7)");
        }
        // 第 8 名额外 key：超长不得截断后接受
        final String eightPlayers = "\"players\":[" + playersWithCustomP1("HIGH", "EXACT").substring(11)
                + ",{\"playerKey\":\"P8\",\"contribution\":\"LOW\",\"confidence\":\"PARTIAL\"}]";
        assertNull(TeamAutopsyParser.parse(
                lossBody(eightPlayers, verdictJson("P1", "r", "e", "PARTIAL")),
                ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void rejectsMoreThanThreeVerdicts() {
        final StringBuilder liabilities = new StringBuilder();
        for (int i = 1; i <= 4; i++) {
            if (i > 1) {
                liabilities.append(',');
            }
            liabilities.append(verdictJson("P" + i, "r" + i, "e" + i, "PARTIAL"));
        }
        assertNull(TeamAutopsyParser.parse(
                lossBody(allPlayers("HIGH", "EXACT"), liabilities.toString()),
                ROSTER, Winner.ENEMY_WIN));
    }

    @Test
    void garbageReturnsNull() {
        assertNull(TeamAutopsyParser.parse("not json", ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse("", ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse(null, ROSTER, Winner.ENEMY_WIN));
        assertNull(TeamAutopsyParser.parse("{\"players\":[]}", ROSTER, Winner.DRAW_OR_UNKNOWN));
    }
}
