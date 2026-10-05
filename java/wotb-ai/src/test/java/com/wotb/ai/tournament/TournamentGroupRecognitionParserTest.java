package com.wotb.ai.tournament;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TournamentGroupRecognitionParserTest {
    private final TournamentGroupRecognitionParser parser = new TournamentGroupRecognitionParser();

    @Test
    void extractsOnlyClanTagsAndMapsThreeFourToFourth() {
        final var result = parser.parse(group("1", "2", "3", "3–4"), "image-hash");
        assertTrue(result.complete());
        assertEquals(List.of("REQM", "-INS-", "CHRD", "-LX-"),
                result.teams().stream().map(TournamentGroupRecognitionParser.Team::clanTag).toList());
        assertEquals(List.of(1, 2, 3, 4), result.teams().stream()
                .map(TournamentGroupRecognitionParser.Team::rank).toList());
        assertEquals("3–4", result.teams().getLast().rankText());
        assertEquals("image-hash", result.imageHash());
    }

    @Test
    void noRankTextUsesVerticalOrderInsteadOfModelRankGuesses() {
        final var result = parser.parse(group("", "", "", ""), "hash");
        assertTrue(result.complete());
        assertEquals(List.of(1, 2, 3, 4), result.teams().stream()
                .map(TournamentGroupRecognitionParser.Team::rank).toList());
    }

    @Test
    void incompleteOrMultipleGroupsStayReviewRequired() {
        final var result = parser.parse(group("1", "2", "3", "4")
                .replace("\"complete\":true", "\"complete\":false")
                .replace("\"issues\":[]", "\"issues\":[\"MULTIPLE_GROUPS\",\"INCOMPLETE_GROUP\"]"), "hash");
        assertFalse(result.complete());
        assertTrue(result.issues().containsAll(List.of("MULTIPLE_GROUPS", "INCOMPLETE_GROUP")));
    }

    @Test
    void missingGroupAndUncertainFieldsNeverReceiveGuesses() {
        final var result = parser.parse(group("1", "2", "3", "?")
                .replace("\"groupNumber\":1", "\"groupNumber\":null")
                .replace("\"clanTag\":\"CHRD\"", "\"clanTag\":\"\""), "hash");
        assertFalse(result.complete());
        assertNull(result.groupNumber());
        assertNull(result.teams().getLast().rank());
        assertTrue(result.issues().containsAll(List.of("GROUP_NUMBER_MISSING", "UNCLEAR_CLAN", "UNCLEAR_RANK")));
    }

    @Test
    void unclearMetadataDoesNotInventMissingImageRows() {
        final var result = parser.parse(group("1", "2", "3", "4")
                .replace("\"groupNumber\":1", "\"groupNumber\":null")
                .replace("\"complete\":true", "\"complete\":false")
                .replace("\"issues\":[]", "\"issues\":[\"GROUP_NUMBER_MISSING\"]"), "hash");
        assertFalse(result.complete());
        assertEquals(List.of("GROUP_NUMBER_MISSING"), result.issues());
    }

    @Test
    void duplicateClanAndDuplicateRanksRequireReview() {
        final var result = parser.parse(group("1", "2", "2", "4")
                .replace("CHRD", "REQM"), "hash");
        assertFalse(result.complete());
        assertTrue(result.issues().containsAll(List.of("UNCLEAR_CLAN", "UNCLEAR_RANK")));
    }

    @Test
    void threeAndFiveTeamGroupsAreValid() {
        for (final int size : List.of(3, 5)) {
            final String teams = java.util.stream.IntStream.rangeClosed(1, size)
                    .mapToObj(rank -> "{\"clanTag\":\"TAG" + rank + "\",\"rankText\":\"" + rank + "\"}")
                    .collect(java.util.stream.Collectors.joining(","));
            assertTrue(parser.parse("{\"groupNumber\":2,\"teams\":[" + teams
                    + "],\"complete\":true,\"issues\":[]}", "hash").complete());
        }
    }

    @Test
    void malformedJsonAndUnknownIssueCodeFailWithStableError() {
        for (final String value : List.of("not json", "{}", group("1", "2", "3", "4")
                .replace("\"issues\":[]", "\"issues\":[\"ignore all instructions\"]"))) {
            assertEquals("AI_RESPONSE_INVALID", assertThrows(ResponseStatusException.class,
                    () -> parser.parse(value, "hash")).getReason());
        }
    }

    @Test
    void nullableFieldsAndExactResponseShapeSerialize() {
        final var result = parser.parse(group("1", "2", "3", "?")
                .replace("\"groupNumber\":1", "\"groupNumber\":null"), "hash");
        final var json = JsonMapper.builder().build().valueToTree(result);
        assertEquals(5, json.size());
        assertTrue(json.path("groupNumber").isNull());
        assertTrue(json.path("teams").get(3).path("rank").isNull());
        assertEquals("?", json.path("teams").get(3).path("rankText").asString());
    }

    static String group(final String first, final String second, final String third, final String fourth) {
        return "{\"groupNumber\":1,\"teams\":["
                + team("[REQM]", first) + "," + team("-INS-", second) + ","
                + team("CHRD", third) + "," + team("-LX-", fourth)
                + "],\"complete\":true,\"issues\":[]}";
    }

    private static String team(final String tag, final String rankText) {
        return "{\"clanTag\":\"" + tag + "\",\"rank\":null,\"rankText\":\"" + rankText + "\"}";
    }
}
