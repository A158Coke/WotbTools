package com.wotb.web.replay.controller;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.ai.AnalyzeResult;
import com.wotb.web.replay.ai.TeamAnalyzeResult;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReconstructionControllerTeamAnalysisTest {

    private DefaultReplayProcessingFacade processingFacade;
    private AiReplayAnalysisService aiService;
    private AiReplayReviewService reviewService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        processingFacade = mock(DefaultReplayProcessingFacade.class);
        aiService = mock(AiReplayAnalysisService.class);
        reviewService = spy(new AiReplayReviewService(processingFacade, aiService));
        final var controller = new ReconstructionController(
                processingFacade, reviewService, new AiCancellationRegistry());
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void uploadWithTwoFilesReturnsReplayFileCountExceeded() throws Exception {
        final var request = multipart("/api/replay/analyze")
                .param("lang", "zh")
                .file(replayFile("a.wotbreplay"))
                .file(replayFile("b.wotbreplay"));

        mvc.perform(request)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("REPLAY_FILE_COUNT_EXCEEDED"))
                .andExpect(jsonPath("$.maxFiles").value(1))
                .andExpect(jsonPath("$.actualFiles").value(2));
        // Processing facade and AI provider must not be called
        verify(processingFacade, never()).process(any(Source.class), any(ReplayProcessingOptions.class));
        verify(aiService, never()).analyzeTeamGroups(any(), any());
        verify(aiService, never()).analyzePlayerOrFallback(any(), any());
    }

    @Test
    void uploadWithTwoIdenticalFilesAlsoRejectedByCount() throws Exception {
        final var file = replayFile("same.wotbreplay");
        final var request = multipart("/api/replay/analyze")
                .param("lang", "zh")
                .file(file)
                .file(file);

        mvc.perform(request)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("REPLAY_FILE_COUNT_EXCEEDED"))
                .andExpect(jsonPath("$.maxFiles").value(1))
                .andExpect(jsonPath("$.actualFiles").value(2));
        verify(processingFacade, never()).process(any(Source.class), any(ReplayProcessingOptions.class));
    }

    @Test
    void emptyFilesArrayReturnsNoReplayFiles() throws Exception {
        mvc.perform(multipart("/api/replay/analyze").param("lang", "zh"))
                .andExpect(status().isBadRequest());
        verify(processingFacade, never()).process(any(Source.class), any(ReplayProcessingOptions.class));
        verify(aiService, never()).analyzeTeamGroups(any(), any());
    }

    @Test
    void trainingReplayUsesSingleTeamAnalysis() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "training.wotbreplay", "arena-one", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenReturn(teamAiResult("team review"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("training.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("team review"));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService).analyzeTeamGroups(captor.capture(), any());
        assertEquals(1, captor.getValue().size());
        assertEquals(1, captor.getValue().getFirst().key().perspectiveTeam());
        verify(aiService, never()).analyzePlayerOrFallback(any(), any());
    }

    @Test
    void singleTeamUploadAnalyzesOnce() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "single.wotbreplay", "test-arena", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenReturn(teamAiResult("single review"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("single.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("single review"));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService, times(1)).analyzeTeamGroups(captor.capture(), any());
        assertEquals(1, captor.getValue().size());
        verify(aiService, never()).analyzePlayerOrFallback(any(), any());
    }

    @Test
    void singleTeamUsesMultiTeamAnalysis() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "team.wotbreplay", "team-arena", "Player", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenReturn(teamAiResult("team review"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("team.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("team review"));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService).analyzeTeamGroups(captor.capture(), any());
        assertEquals(1, captor.getValue().size());
        assertEquals(1, captor.getValue().getFirst().key().perspectiveTeam());
    }

    @Test
    void authoritativeSummaryFallbackRemainsAvailableWithoutReconstruction()
            throws Exception {
        final ReplayProcessingResult fallback = teamResult(
                "fallback.wotbreplay", "fallback-arena", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(fallback);
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenReturn(teamAiResult("fallback review"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("fallback.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("fallback review"));
    }

    @Test
    void teamAnalysisResponseContainsOnlyText() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "training.wotbreplay", "arena-one", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenReturn(new TeamAnalyzeResult(new AnalyzeResult("team review")));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("training.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("team review"));
    }

    @Test
    void singleBattleTeamAnalysis() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "battle.wotbreplay", "battle-arena", "Player", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenReturn(teamAiResult("team review"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("battle.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("team review"));
    }

    @Test
    void unresolvedPerspectiveReturnsStable422Error() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(unresolvedTeamResult());

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("observer.wotbreplay")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(content().string("PERSPECTIVE_TEAM_UNRESOLVED"));

        verify(aiService, never()).analyzeTeamGroups(any(), any());
    }

    @Test
    void conflictingPerspectiveReturnsSpecificStable422Error() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(conflictingTeamResult());

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("conflict.wotbreplay")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(content().string("PERSPECTIVE_TEAM_CONFLICT"));

        verify(aiService, never()).analyzeTeamGroups(any(), any());
    }

    @Test
    void resolvedTeamWithoutSummaryOrMappedFeaturesReturnsStable400Error()
            throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(resolvedTeamWithoutFeatures());

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("no-features.wotbreplay")))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("TEAM_FEATURES_UNAVAILABLE"));

        verify(aiService, never()).analyzeTeamGroups(any(), any());
    }

    @Test
    void resolvedTeamAnalysisReturnsOk() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "resolved.wotbreplay", "resolved-arena", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenReturn(teamAiResult("review"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("resolved.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("review"));
    }

    @Test
    void promptBudgetExceededReturnsCorrectHttpStatus() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "budget.wotbreplay", "budget-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenThrow(new AiPromptBudgetExceededException());

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("budget.wotbreplay")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("AI_PROMPT_MANDATORY_SECTION_TOO_LARGE"));
    }

    @Test
    void missingAiConfigurationReturnsStable503Error() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "config.wotbreplay", "config-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenThrow(new AiNotConfiguredException());

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("config.wotbreplay")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().string("AI_NOT_CONFIGURED"));
    }

    @Test
    void upstreamFailureReturnsOnlyStableCode() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "rate.wotbreplay", "rate-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any(), any()))
                .thenThrow(new AiUpstreamException(
                        "AI_RATE_LIMITED", 429, "private-correlation-id"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("rate.wotbreplay")))
                .andExpect(status().isBadGateway())
                .andExpect(content().string("AI_RATE_LIMITED"));
    }

    @Test
    void randomBattleKeepsPlayerFocusedPath() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(randomResult());
        when(aiService.analyzePlayerOrFallback(any(), any()))
                .thenReturn(new AnalyzeResult("player review"));

        mvc.perform(multipart("/api/replay/analyze")
                        .param("lang", "zh")
                        .file(replayFile("random.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysis").value("player review"));

        verify(aiService).analyzePlayerOrFallback(any(), any());
        verify(aiService, never()).analyzeTeamGroups(any(), any());
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static ArgumentCaptor<List<ReplayPerspectiveGroup>> teamGroupCaptor() {
        return (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
    }

    private static TeamAnalyzeResult teamAiResult(
            final String analysis
    ) {
        return new TeamAnalyzeResult(new AnalyzeResult(analysis));
    }

    private static MockMultipartFile replayFile(final String fileName) {
        return new MockMultipartFile(
                "files", fileName, "application/octet-stream", new byte[]{1});
    }

    private static ReplayProcessingResult teamResult(
            final String fileName,
            final String arenaId,
            final String recorderNickname,
            final long recorderAccountId,
            final int recorderTeam
    ) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = recorderNickname;
        battle.players = List.of(
                player(
                        recorderTeam == 1 ? recorderAccountId : 1001L,
                        recorderTeam == 1 ? recorderNickname : "Ally",
                        1),
                player(
                        recorderTeam == 2 ? recorderAccountId : 2001L,
                        recorderTeam == 2 ? recorderNickname : "Enemy",
                        2));
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                fileName,
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "hash-" + fileName,
                        arenaId,
                        "11.0",
                        "team_map",
                        recorderAccountId,
                        null),
                battle,
                null,
                null,
                capabilities,
                null,
                null);
    }

    private static ReplayProcessingResult unresolvedTeamResult() {
        final Battle battle = new Battle();
        battle.arenaId = "observer-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.recorder = "Observer";
        battle.players = List.of();
        final var capabilities = new ReplayProcessingCapabilities(
                true, false, false, false, false, false, false, false);
        return new ReplayProcessingResult(
                "observer.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "observer-hash",
                        "observer-arena",
                        "11.0",
                        "team_map",
                        null,
                        null),
                battle,
                null,
                null,
                capabilities,
                null,
                null);
    }

    private static ReplayProcessingResult conflictingTeamResult() {
        final Battle battle = new Battle();
        battle.arenaId = "conflict-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.recorder = "SameName";
        battle.players = List.of(
                player(1001L, "SameName", 1),
                player(2001L, "SameName", 2));
        final var capabilities = new ReplayProcessingCapabilities(
                true, false, false, false, false, false, false, false);
        return new ReplayProcessingResult(
                "conflict.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "conflict-hash",
                        "conflict-arena",
                        "11.0",
                        "team_map",
                        null,
                        null),
                battle,
                null,
                null,
                capabilities,
                null,
                null);
    }

    private static ReplayProcessingResult resolvedTeamWithoutFeatures() {
        final Battle battle = new Battle();
        battle.arenaId = "no-features-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.recorder = "";
        battle.players = List.of();
        final ReplayReconstruction reconstruction = new ReplayReconstruction(
                null,
                null,
                300f,
                null,
                List.of(new BattleParticipant(
                        1001L, "Recorder", 1, 1, "tank", true)),
                List.of(),
                List.of(),
                null,
                null,
                null);
        final var capabilities = new ReplayProcessingCapabilities(
                true, false, true, true, false, true, false, false);
        return new ReplayProcessingResult(
                "no-features.wotbreplay",
                ReplayProcessingStatus.SUCCESS,
                new ReplayIdentity(
                        "no-features-hash",
                        "no-features-arena",
                        "11.0",
                        "team_map",
                        null,
                        null),
                battle,
                reconstruction,
                null,
                capabilities,
                null,
                null);
    }

    private static ReplayProcessingResult randomResult() {
        final Battle battle = new Battle();
        battle.arenaId = "random-arena";
        battle.mapName = "random_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = "Player";
        battle.players = List.of(player(1001L, "Player", 1));
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        return new ReplayProcessingResult(
                "random.wotbreplay",
                ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity(
                        "random-hash",
                        "random-arena",
                        "11.0",
                        "random_map",
                        1001L,
                        null),
                battle,
                null,
                null,
                capabilities,
                null,
                null);
    }

    private static PlayerResult player(
            final long accountId,
            final String nickname,
            final int team
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        player.damageDealt = 1_000;
        player.survived = true;
        return player;
    }

    @Test
    void missingLangIsRejectedAsRequiredParameter() throws Exception {
        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("a.wotbreplay")))
                .andExpect(status().isBadRequest());
        verify(aiService, never()).analyzePlayerOrFallback(any(), any());
    }

    @Test
    void blankLangReturnsUnknownLocale() throws Exception {
        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("a.wotbreplay"))
                        .param("lang", ""))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.TEXT_PLAIN))
                .andExpect(content().string("UNKNOWN_LOCALE"));
        verify(aiService, never()).analyzePlayerOrFallback(any(), any());
    }

    @Test
    void unknownLangReturnsUnknownLocale() throws Exception {
        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("a.wotbreplay"))
                        .param("lang", "fr"))
                .andExpect(status().isBadRequest())
        .andExpect(content().contentType(MediaType.TEXT_PLAIN))
                .andExpect(content().string("UNKNOWN_LOCALE"));
        verify(aiService, never()).analyzePlayerOrFallback(any(), any());
    }

    @Test
    void langEnIsForwardedToReviewService() throws Exception {
        doReturn(minimalAnalyzeResponse())
                .when(reviewService).analyze(any(), any(AllowedLanguage.class));
        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("a.wotbreplay"))
                        .param("lang", "en"))
                .andExpect(status().isOk());
        verify(reviewService).analyze(any(), eq(AllowedLanguage.EN));
    }

    @Test
    void langRuIsForwardedToReviewService() throws Exception {
        doReturn(minimalAnalyzeResponse())
                .when(reviewService).analyze(any(), any(AllowedLanguage.class));
        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("a.wotbreplay"))
                        .param("lang", "ru"))
                .andExpect(status().isOk());
        verify(reviewService).analyze(any(), eq(AllowedLanguage.RU));
    }

    private static AnalyzeResponse minimalAnalyzeResponse() {
        return new AnalyzeResponse("ok");
    }
}
