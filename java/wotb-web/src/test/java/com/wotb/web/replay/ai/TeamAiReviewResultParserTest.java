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
    void parsesValidResultAndReferences() {
        final TeamAiReviewResultParser.ParseResult result =
                TeamAiReviewResultParser.parse(VALID, Set.of("P1", "P2"));
        assertFalse(result.failed());
        assertEquals("E1", result.result().episodes().get(0).id());
        assertEquals("P1", result.result().reviewFocus().get(0).playerKey());
    }

    @Test
    void requiresAllTopLevelArraysAndRejectsReferences() {
        assertTrue(TeamAiReviewResultParser.parse(
                "{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                        + "\"episodes\":[],\"trainingSuggestions\":[],\"reviewFocus\":[]}", Set.of())
                .failed());
        assertEquals(TeamAiReviewResultParser.Failure.INVALID_REFERENCE,
                TeamAiReviewResultParser.parse(VALID.replace("P1", "P9"), Set.of("P1")).failure());
    }

    @Test
    void enforcesCardinality() {
        final String tooMany = VALID.replace(
                "\"highContributors\":[]",
                "\"highContributors\":[{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"r\"},"
                        + "{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"r\"},"
                        + "{\"playerKey\":\"P1\",\"episodeId\":\"E1\",\"reason\":\"r\"}]");
        assertEquals(TeamAiReviewResultParser.Failure.CARDINALITY_EXCEEDED,
                TeamAiReviewResultParser.parse(tooMany, Set.of("P1")).failure());
    }

    @Test
    void requiresNullableFieldsToBePresentAndRejectsUnknownFields() {
        assertEquals(TeamAiReviewResultParser.Failure.MISSING_REQUIRED_FIELD,
                TeamAiReviewResultParser.parse(VALID.replace(
                        "\"startSec\":10,", ""), Set.of("P1")).failure());
        assertEquals(TeamAiReviewResultParser.Failure.MISSING_REQUIRED_FIELD,
                TeamAiReviewResultParser.parse(VALID.replace(
                        "\"trainingSuggestions\":[{\"title\":\"建议\",\"content\":\"内容\",\"episodeId\":\"E1\"}]",
                        "\"trainingSuggestions\":[{\"title\":\"建议\",\"content\":\"内容\"}]"),
                        Set.of("P1")).failure());
        assertEquals(TeamAiReviewResultParser.Failure.INVALID_FIELD,
                TeamAiReviewResultParser.parse(VALID.replace(
                        "\"highContributors\":[]", "\"highContributors\":[],\"extra\":true"),
                        Set.of("P1")).failure());
    }
}
