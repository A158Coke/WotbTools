package com.wotb.ai.review;

import com.wotb.ai.gateway.AiChatResponse;
import com.wotb.ai.gateway.AiResponseFormat;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamReplayAnalysisServiceDiagnosticsTest extends TeamReplayAnalysisServiceTestSupport {

    @Test
    void recoveryLogsPrimaryCompletionLengthAndCumulativeTokens() {
        final String primaryCompletion = "{}";
        gateway.teamResponseSequence.add(new AiChatResponse(primaryCompletion, "DeepSeek", "test-model",
                11, 13, 24, 0, 0, 0, "stop"));
        gateway.teamResponseSequence.add(new AiChatResponse(structuredResult(), "DeepSeek", "test-model",
                17, 19, 36, 0, 0, 0, "stop"));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("recovery-metadata-arena", "Ally", 1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertTrue(teamReviewEvents("ai_review_recovery_triggered").stream()
                .anyMatch(message -> message.contains("primaryResponseLength=2")));
        assertEquals(AiResponseFormat.JSON_OBJECT, allTeamReviewRequests().getLast().responseFormat());
        assertTrue(teamReviewEvents("team_review_completed").stream()
                .anyMatch(message -> message.contains("result=RECOVERY_SUCCESS")
                        && message.contains("totalPromptTokens=28")
                        && message.contains("totalCompletionTokens=32")));
    }

    @Test
    void recoveryStructuredResultLogsCumulativeTokensAndUsesExactlyTwoCalls() {
        gateway.teamResponseSequence.add(new AiChatResponse("{}", "DeepSeek", "test-model",
                5, 7, 12, 0, 0, 0, "stop"));
        gateway.teamResponseSequence.add(new AiChatResponse(
                structuredResult(), "DeepSeek", "test-model",
                11, 13, 24, 0, 0, 0, "stop"));
        final var service = startService();

        final AiReviewDonePayload result = analyzeTeam(service, teamResultWithRecon("recovery-plain-text-arena", "Ally",
                1001L, 1), AllowedLanguage.ZH);

        assertNotNull(result.teamReview());
        assertEquals(2, allTeamReviewRequests().size());
        assertEquals("SINGLE_TEAM_BATTLE_RECOVERY", allTeamReviewRequests().getLast().analysisMode());
        assertTrue(teamReviewEvents("team_review_completed").stream()
                .anyMatch(message -> message.contains("result=RECOVERY_SUCCESS")
                        && message.contains("totalPromptTokens=16")
                        && message.contains("totalCompletionTokens=20")));
    }

    @Test
    void teamStreamingEmitsEvidenceDoneBeforeReviewCall() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final List<String> stages = new CopyOnWriteArrayList<>();
        final List<String> tokens = new CopyOnWriteArrayList<>();
        service.analyzeTeam(fixture.battle(), fixture.reconstruction(), AllowedLanguage.ZH,
                new AiReviewStreamListener() {
            @Override
            public void onStage(final String stage) {
                stages.add(stage);
            }

            @Override
            public void onToken(final String delta) {
                tokens.add(delta);
            }
        });
        assertTrue(stages.contains("evidence_done"),
                "team path must emit evidence_done so the stage indicator advances: " + stages);
        assertTrue(gateway.requests.stream()
                        .anyMatch(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode())),
                "team Call #2 request must be issued");
    }
}
