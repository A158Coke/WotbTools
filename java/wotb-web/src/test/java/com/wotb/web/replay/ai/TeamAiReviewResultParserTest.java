package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamAiReviewResultParserTest {

    private static final String VALID = "{"
            + "\"summary\":{\"verdict\":\"结论\",\"primaryDiagnosis\":\"诊断\"},"
            + "\"episodes\":[{\"id\":\"E1\",\"startSec\":10,\"endSec\":20,"
            + "\"title\":\"关键回合\",\"analysis\":\"分析\",\"playerKeys\":[\"P1\"]}],"
            + "\"trainingSuggestions\":[{\"title\":\"建议\",\"content\":\"内容\",\"episodeId\":\"E1\"}],"
            + "\"reviewFocus\":[{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"复查\"}],"
            + "\"highContributors\":[]}";

    @Test
    void parsesValidResultWithoutNormalization() {
        final TeamAiReviewResultParser.ParseResult result =
                TeamAiReviewResultParser.parse(VALID, Set.of("P1", "P2"));
        assertEquals(TeamAiReviewResultParser.ParseStatus.VALID, result.status());
        assertFalse(result.failed());
        assertEquals("E1", result.result().episodes().getFirst().id());
        assertEquals("P1", result.result().reviewFocus().getFirst().playerKey());
    }

    @Test
    void dropsInvalidOptionalReferencesAndKeepsTacticalText() {
        final String output = VALID
                .replace("\"P1\"]", "\"P1\",\"P9\"]")
                .replace("\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"复查\"",
                        "\"playerKey\":\"P9\",\"episodeId\":\"E99\",\"reason\":\"复查\"")
                .replace("\"highContributors\":[]",
                        "\"highContributors\":[{\"playerKey\":\"P9\",\"episodeId\":\"E1\",\"reason\":\"贡献\"}]")
                .replace("\"episodeId\":\"E1\"}]", "\"episodeId\":\"E99\"}]");
        final TeamAiReviewResultParser.ParseResult result =
                TeamAiReviewResultParser.parse(output, Set.of("P1"));
        assertEquals(TeamAiReviewResultParser.ParseStatus.VALID_WITH_NORMALIZATION, result.status());
        assertFalse(result.failed());
        assertEquals("分析", result.result().episodes().getFirst().analysis());
        assertEquals(0, result.result().reviewFocus().size());
        assertEquals(0, result.result().highContributors().size());
        assertEquals(null, result.result().trainingSuggestions().getFirst().episodeId());
        assertTrue(result.normalizations().size() >= 4);
        assertTrue(result.failures().stream().anyMatch(f ->
                f.path().equals("highContributors[0].playerKey")));
    }

    @Test
    void reportsRepairableUnknownFieldWithPrecisePath() {
        final TeamAiReviewResultParser.ParseResult result = TeamAiReviewResultParser.parse(
                VALID.replace("\"highContributors\":[]", "\"highContributors\":[],\"extra\":true"),
                Set.of("P1"));
        assertEquals(TeamAiReviewResultParser.ParseStatus.REPAIRABLE, result.status());
        assertFalse(result.failed());
        assertEquals(TeamAiReviewResultParser.Failure.INVALID_FIELD, result.failure());
        assertEquals("root.extra", result.failures().getFirst().path());
    }

    @Test
    void boundsMetricPathClassForRandomUnknownFields() {
        final Set<String> pathClasses = Set.copyOf(java.util.stream.IntStream.range(0, 100)
                .mapToObj(index -> {
                    final TeamAiReviewResultParser.ParseResult parsed = TeamAiReviewResultParser.parse(
                            VALID.replace("\"highContributors\":[]",
                                    "\"highContributors\":[],\"generated_field_" + index + "\":true"),
                            Set.of("P1"));
                    return TeamReplayAnalysisService.pathClass(parsed.failures().getFirst().path());
                })
                .toList());
        assertEquals(Set.of("root.unknown_field"), pathClasses);
    }

    @Test
    void defaultsMissingEmptyCompatibleSectionsWithoutRepair() {
        final String output = VALID
                .replace("\"trainingSuggestions\":[{\"title\":\"建议\",\"content\":\"内容\",\"episodeId\":\"E1\"}],", "")
                .replace("\"reviewFocus\":[{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"复查\"}],", "")
                .replace(",\"highContributors\":[]", "");
        final TeamAiReviewResultParser.ParseResult result =
                TeamAiReviewResultParser.parse(output, Set.of("P1"));

        assertEquals(TeamAiReviewResultParser.ParseStatus.VALID_WITH_NORMALIZATION, result.status());
        assertTrue(result.result().trainingSuggestions().isEmpty());
        assertTrue(result.result().reviewFocus().isEmpty());
        assertTrue(result.result().highContributors().isEmpty());
        assertTrue(result.failures().isEmpty());
    }

    @Test
    void defaultsMissingEpisodeTimesToNull() {
        final TeamAiReviewResultParser.ParseResult result = TeamAiReviewResultParser.parse(
                VALID.replace("\"startSec\":10,", "").replace("\"endSec\":20,", ""),
                Set.of("P1"));

        assertEquals(TeamAiReviewResultParser.ParseStatus.VALID_WITH_NORMALIZATION, result.status());
        assertEquals(null, result.result().episodes().getFirst().startSec());
        assertEquals(null, result.result().episodes().getFirst().endSec());
    }

    @Test
    void reportsFatalCoreFailures() {
        assertEquals(TeamAiReviewResultParser.ParseStatus.FATAL,
                TeamAiReviewResultParser.parse("{\"episodes\":[]}", Set.of()).status());
        assertEquals(TeamAiReviewResultParser.ParseStatus.FATAL,
                TeamAiReviewResultParser.parse(VALID.replace("\"startSec\":10,", ""), Set.of("P1")).status());
        assertEquals(TeamAiReviewResultParser.ParseStatus.FATAL,
                TeamAiReviewResultParser.parse(VALID.replace("\"endSec\":20", "\"endSec\":5"), Set.of("P1")).status());
        final String duplicate = VALID.replace(
                "\"playerKeys\":[\"P1\"]}],",
                "\"playerKeys\":[\"P1\"]},{\"id\":\"E1\",\"startSec\":30,\"endSec\":40,\"title\":\"x\",\"analysis\":\"y\",\"playerKeys\":[]}],");
        assertEquals(TeamAiReviewResultParser.ParseStatus.FATAL,
                TeamAiReviewResultParser.parse(duplicate, Set.of("P1")).status());
    }

    @Test
    void reportsRepairableCardinality() {
        final String tooMany = VALID.replace(
                "\"highContributors\":[]",
                "\"highContributors\":[{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"r\"},"
                        + "{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"r\"},"
                        + "{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"r\"}]");
        final TeamAiReviewResultParser.ParseResult result =
                TeamAiReviewResultParser.parse(tooMany, Set.of("P1"));
        assertEquals(TeamAiReviewResultParser.ParseStatus.REPAIRABLE, result.status());
        assertEquals(TeamAiReviewResultParser.Failure.CARDINALITY_EXCEEDED, result.failure());
    }

    @Test
    void rejectsUnknownIdentityFieldsInOptionalItemsByDroppingItem() {
        final TeamAiReviewResultParser.ParseResult result = TeamAiReviewResultParser.parse(VALID.replace(
                "\"reason\":\"复查\"", "\"reason\":\"复查\",\"nickname\":\"Alice\""),
                Set.of("P1"));
        assertEquals(TeamAiReviewResultParser.ParseStatus.VALID_WITH_NORMALIZATION, result.status());
        assertTrue(result.result().reviewFocus().isEmpty());
    }
}
