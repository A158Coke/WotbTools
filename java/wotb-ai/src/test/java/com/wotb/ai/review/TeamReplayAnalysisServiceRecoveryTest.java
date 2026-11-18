package com.wotb.ai.review;

import com.wotb.ai.gateway.AiUpstreamException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamReplayAnalysisServiceRecoveryTest extends TeamReplayAnalysisServiceTestSupport {

    @Test
    void invalidOptionalSchemaReferencesAreSalvagedWithoutRecovery() {
        gateway.teamCompletionSequence.add(optionalReferencesResult());
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("normalized-arena", "Ally", 1001L, 1);

        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_contract_salvage_completed").stream()
                .anyMatch(message -> message.contains("result=SUCCESS")));
    }

    @Test
    void salvageableUnknownFieldDoesNotTriggerRecovery() {
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":[],\"trainingSuggestions\":[],\"reviewFocus\":[],"
                + "\"highContributors\":[],\"unknown\":true}");
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("repair-arena", "Ally", 1001L, 1);

        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_contract_salvage_completed").stream()
                .anyMatch(message -> message.contains("root.unknown_field")));
    }

    @Test
    void incidentInvalidReferencesAreSalvagedWithoutRecovery() {
        final String initial = "{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":[{\"id\":\"E1\",\"startSec\":10,\"endSec\":20,"
                + "\"title\":\"title\",\"analysis\":\"TACTICAL_TEXT\",\"playerKeys\":[]}],"
                + "\"trainingSuggestions\":[],\"reviewFocus\":[],"
                + "\"highContributors\":[{\"playerKey\":\"UNKNOWN_PLAYER\","
                + "\"episodeId\":\"E1\",\"reason\":\"reason\"}],\"unknown\":true}";
        gateway.teamCompletionSequence.add(initial);
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("mixed-repair-arena", "Ally", 1001L, 1);

        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_contract_salvage_completed").stream()
                .anyMatch(message -> message.contains("removedReferences=1")));
    }

    @Test
    void partiallyInvalidEpisodePlayerKeysAreFilteredWithoutRecovery() {
        gateway.teamCompletionSequence.add(structuredResultWithEpisode()
                .replace("\"playerKeys\":[]", "\"playerKeys\":[\"P1\",\"UNKNOWN\",\"P1\"]"));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("partial-player-keys-arena",
                "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(List.of("P1", "P1"),
                result.teamReview().episodes().getFirst().playerKeys());
        assertEquals(1, allTeamReviewRequests().size());
    }

    @Test
    void recoveryUnknownFieldsAreRejectedWithoutThirdCall() {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\","
                + "\"unknown_field\":\"repair metadata\"},\"episodes\":[],"
                + "\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[],"
                + "\"unknown_field\":\"repair metadata\"}");
        final var service = startService();

        final AiUpstreamException error = assertThrows(AiUpstreamException.class,
                () -> analyzeTeam(service, teamResultWithRecon("recovery-unknown-arena",
                        "Ally", 1001L, 1), AllowedLanguage.ZH));

        assertEquals("AI_REVIEW_SCHEMA_FAILED", error.code());
        assertEquals(2, allTeamReviewRequests().size());
        assertTrue(allTeamReviewRequests().getLast().systemPrompt().contains("RECOVERY 严格约束"));
    }

    @Test
    void recoveryFailureStopsAfterExactlyTwoCallsWithNoUsableResult() {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add("not json");
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("repair-fail-arena", "Ally", 1001L, 1);

        final AiUpstreamException error = assertThrows(AiUpstreamException.class,
                () -> analyzeTeam(service, fixture, AllowedLanguage.ZH));

        assertEquals("AI_REVIEW_SCHEMA_FAILED", error.code());
        assertEquals(2, allTeamReviewRequests().size());
    }

    @Test
    void truncatedJsonWithReadableStringsTriggersOnlyOneRecovery() {
        gateway.teamCompletionSequence.add(
                "{\"summary\":{\"verdict\":\"本局开局过度分散，中期应该保持集火并尽快转场");
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("truncated-json-arena", "Ally",
                1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").stream()
                .anyMatch(message -> message.contains("reason=UNPARSEABLE_RESPONSE")));
    }

    @Test
    void oversizedInvalidJsonTriggersOneRecovery() {
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"" + "x".repeat(65_000));
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("long-plain-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
    }

    @Test
    void validStructuredJsonRemainsSingleCall() {
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("large-structured-arena", "Ally",
                1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(1, allTeamReviewRequests().size());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").isEmpty());
    }

    @Test
    void recoveryRunsOnlyWhenPrimaryHasNoUsableContent() {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("recovery-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").stream()
                .anyMatch(message -> message.contains("reason=MINIMUM_CONTRACT_UNRECOVERABLE")));
    }

    @Test
    void episodeCardinalitySalvageUsesOnlyPrimaryCall() {
        gateway.teamCompletionSequence.add(structuredResultWithEpisodes(
                TeamAiReviewResultParser.MAX_EPISODES + 1));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("cardinality-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(TeamAiReviewResultParser.MAX_EPISODES, result.teamReview().episodes().size());
        assertEquals(1, allTeamReviewRequests().size(), "cardinality salvage must not trigger recovery");
    }

    @Test
    void wrongEpisodesTypeTriggersExactlyOneRecovery() {
        gateway.teamCompletionSequence.add("{\"summary\":{\"verdict\":\"v\",\"primaryDiagnosis\":\"d\"},"
                + "\"episodes\":\"wrong-type\",\"trainingSuggestions\":[],\"reviewFocus\":[],"
                + "\"highContributors\":[]}");
        gateway.teamCompletionSequence.add(structuredResult());
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("wrong-type-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
    }

    @ParameterizedTest
    @ValueSource(strings = {"EN", "RU"})
    void recoveryUserInstructionFollowsAllowedLanguage(final String languageName) {
        gateway.teamCompletionSequence.add("{}");
        gateway.teamCompletionSequence.add(structuredResult());
        final AllowedLanguage language = AllowedLanguage.valueOf(languageName);
        final var service = startService();

        analyzeTeam(service, teamResultWithRecon("localized-recovery-arena", "Ally", 1001L, 1),
                language);

        final String prompt = allTeamReviewRequests().getLast().userPrompt();
        assertFalse(prompt.contains("这是唯一一次 recovery"));
        assertTrue(prompt.contains(language == AllowedLanguage.EN
                ? "This is the only recovery attempt"
                : "Это единственная попытка recovery"));
    }
}
