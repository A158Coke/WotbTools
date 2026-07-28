package com.wotb.web.replay.controller;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.AnalysisUnitResult;
import com.wotb.core.processing.BattleIdentity;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiUpstreamException;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
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
        reviewService = new AiReplayReviewService(processingFacade, aiService);
        final var reconstructionService = mock(ReplayReconstructionService.class);
        final var controller = new ReconstructionController(
                processingFacade, reconstructionService, reviewService);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void uploadWith17FilesReturnsReplayFileCountExceeded() throws Exception {
        final var files = new MockMultipartFile[17];
        for (int i = 0; i < 17; i++) {
            files[i] = replayFile("file" + i + ".wotbreplay");
        }
        var request = multipart("/api/replay/analyze");
        for (final var f : files) {
            request = request.file(f);
        }
        // Real reviewService.analyze() calls validateBatchSize which throws

        mvc.perform(request)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("REPLAY_FILE_COUNT_EXCEEDED"))
                .andExpect(jsonPath("$.maxFiles").value(16))
                .andExpect(jsonPath("$.actualFiles").value(17));
    }

    @Test
    void trainingReplayUsesSingleTeamAnalysis() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "training.wotbreplay", "arena-one", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any()))
                .thenReturn(teamAiResult("team review", List.of(
                        unit("arena-one-team-1", "arena-one", 1, "training.wotbreplay"))));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("training.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("SINGLE_TEAM_BATTLE"))
                .andExpect(jsonPath("$.submittedFileCount").value(1))
                .andExpect(jsonPath("$.validFileCount").value(1))
                .andExpect(jsonPath("$.analysisUnitCount").value(1))
                .andExpect(jsonPath("$.analyzedUnitCount").value(1))
                .andExpect(jsonPath("$.analysis").value("team review"))
                .andExpect(jsonPath("$.files[0].battleCategory").value("TRAINING"))
                .andExpect(jsonPath("$.files[0].analysisScope").value("TEAM_PERSPECTIVE"))
                .andExpect(jsonPath("$.files[0].perspectiveTeam").value(1))
                .andExpect(jsonPath("$.analyses[0].perspectiveTeam").value(1));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService).analyzeTeamGroups(captor.capture());
        assertEquals(1, captor.getValue().size());
        assertEquals(1, captor.getValue().getFirst().key().perspectiveTeam());
        verify(aiService, never()).analyzePlayerOrFallback(any());
    }

    @Test
    void sameBattleSameTeamUploadsCallAiOnce() throws Exception {
        final ReplayProcessingResult first = teamResult(
                "first.wotbreplay", "shared-arena", "Ally", 1001L, 1);
        final ReplayProcessingResult second = teamResult(
                "second.wotbreplay", "shared-arena", "OtherAlly", 1002L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(first, second);
        when(aiService.analyzeTeamGroups(any()))
                .thenReturn(teamAiResult("deduplicated review", List.of(
                        unit("shared-arena-team-1", "shared-arena", 1, "first.wotbreplay"))));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("first.wotbreplay"))
                        .file(replayFile("second.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("SINGLE_TEAM_BATTLE"))
                .andExpect(jsonPath("$.submittedFileCount").value(2))
                .andExpect(jsonPath("$.validFileCount").value(2))
                .andExpect(jsonPath("$.analysisUnitCount").value(1))
                .andExpect(jsonPath("$.analyzedUnitCount").value(1))
                .andExpect(jsonPath("$.sameTeamDuplicatePerspectiveCount").value(1))
                .andExpect(jsonPath("$.files[1].relation")
                        .value("SAME_TEAM_DUPLICATE_PERSPECTIVE"))
                .andExpect(jsonPath("$.files[1].duplicateOfUploadIndex").value(0));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService, times(1)).analyzeTeamGroups(captor.capture());
        assertEquals(1, captor.getValue().size());
        assertEquals(1, captor.getValue().getFirst().duplicates().size());
    }

    @Test
    void opposingTeamsUseIndependentMultiTeamUnits() throws Exception {
        final ReplayProcessingResult allied = teamResult(
                "ally.wotbreplay", "shared-arena", "Ally", 1001L, 1);
        final ReplayProcessingResult enemy = teamResult(
                "enemy.wotbreplay", "shared-arena", "Enemy", 2001L, 2);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(allied, enemy);
        when(aiService.analyzeTeamGroups(any()))
                .thenReturn(teamAiResult("comparison", List.of(
                        unit("shared-arena-team-1", "shared-arena", 1, "ally.wotbreplay"),
                        unit("shared-arena-team-2", "shared-arena", 2, "enemy.wotbreplay"))));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("ally.wotbreplay"))
                        .file(replayFile("enemy.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("MULTI_TEAM_BATTLE"))
                .andExpect(jsonPath("$.analysisUnitCount").value(2))
                .andExpect(jsonPath("$.analyzedUnitCount").value(2))
                .andExpect(jsonPath("$.sameTeamDuplicatePerspectiveCount").value(0))
                .andExpect(jsonPath("$.analyses[0].perspectiveTeam").value(1))
                .andExpect(jsonPath("$.analyses[1].perspectiveTeam").value(2));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService).analyzeTeamGroups(captor.capture());
        assertEquals(List.of(1, 2), captor.getValue().stream()
                .map(group -> group.key().perspectiveTeam())
                .sorted()
                .toList());
    }

    @Test
    void authoritativeSummaryFallbackRemainsAvailableWithoutReconstruction()
            throws Exception {
        final ReplayProcessingResult fallback = teamResult(
                "fallback.wotbreplay", "fallback-arena", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(fallback);
        when(aiService.analyzeTeamGroups(any()))
                .thenReturn(teamAiResult("fallback review", List.of(
                        unit("fallback-arena-team-1",
                                "fallback-arena", 1, "fallback.wotbreplay"))));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("fallback.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("SINGLE_TEAM_BATTLE"))
                .andExpect(jsonPath("$.analysis").value("fallback review"))
                .andExpect(jsonPath("$.files[0].capabilities.reconstructionAvailable")
                        .value(false))
                .andExpect(jsonPath("$.files[0].capabilities.perspectiveTeamResolved")
                        .value(true));
    }

    @Test
    void teamAnalyzedUnitCountMatchesIncluded() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "training.wotbreplay", "arena-one", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any()))
                .thenReturn(new AiReplayAnalysisService.TeamAnalyzeResult(
                        new AiReplayAnalysisService.AnalyzeResult(
                                "team review", "test-model", List.of()),
                        List.of(unit("arena-one-team-1", "arena-one", 1, "training.wotbreplay")),
                        1, 1, 0, List.of()));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("training.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.analysisUnitCount").value(1))
                .andExpect(jsonPath("$.analyzedUnitCount").value(1));
    }

    @Test
    void multipleBattlesUseMultiTeamAnalysis() throws Exception {
        final ReplayProcessingResult first = teamResult(
                "first-battle.wotbreplay", "arena-one", "Ally", 1001L, 1);
        final ReplayProcessingResult second = teamResult(
                "second-battle.wotbreplay", "arena-two", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(first, second);
        when(aiService.analyzeTeamGroups(any()))
                .thenReturn(teamAiResult("trend review", List.of(
                        unit("arena-one-team-1",
                                "arena-one", 1, "first-battle.wotbreplay"),
                        unit("arena-two-team-1",
                                "arena-two", 1, "second-battle.wotbreplay"))));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("first-battle.wotbreplay"))
                        .file(replayFile("second-battle.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("MULTI_TEAM_BATTLE"))
                .andExpect(jsonPath("$.analysisUnitCount").value(2))
                .andExpect(jsonPath("$.analyzedUnitCount").value(2))
                .andExpect(jsonPath("$.analysis").value("trend review"));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService).analyzeTeamGroups(captor.capture());
        assertEquals(
                List.of("arena-one", "arena-two"),
                captor.getValue().stream()
                        .map(group -> group.battleIdentity().arenaUniqueId())
                        .toList());
    }

    @Test
    void unresolvedPerspectiveReturnsStable422Error() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(unresolvedTeamResult());

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("observer.wotbreplay")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(content().string("PERSPECTIVE_TEAM_UNRESOLVED"));

        verify(aiService, never()).analyzeTeamGroups(any());
    }

    @Test
    void conflictingPerspectiveReturnsSpecificStable422Error() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(conflictingTeamResult());

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("conflict.wotbreplay")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(content().string("PERSPECTIVE_TEAM_CONFLICT"));

        verify(aiService, never()).analyzeTeamGroups(any());
    }

    @Test
    void resolvedTeamWithoutSummaryOrMappedFeaturesReturnsStable400Error()
            throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(resolvedTeamWithoutFeatures());

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("no-features.wotbreplay")))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("TEAM_FEATURES_UNAVAILABLE"));

        verify(aiService, never()).analyzeTeamGroups(any());
    }

    @Test
    void unresolvedUnitIsReportedButExcludedWhenAnotherTeamIsAnalyzable()
            throws Exception {
        final ReplayProcessingResult resolved = teamResult(
                "resolved.wotbreplay", "resolved-arena", "Ally", 1001L, 1);
        final ReplayProcessingResult unresolved = unresolvedTeamResult();
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(resolved, unresolved);
        when(aiService.analyzeTeamGroups(any()))
                .thenReturn(teamAiResult("partial batch review", List.of(
                        unit("resolved-arena-team-1",
                                "resolved-arena", 1, "resolved.wotbreplay"))));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("resolved.wotbreplay"))
                        .file(replayFile("observer.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("SINGLE_TEAM_BATTLE"))
                .andExpect(jsonPath("$.validFileCount").value(1))
                .andExpect(jsonPath("$.analysisUnitCount").value(2))
                .andExpect(jsonPath("$.analyzedUnitCount").value(1))
                .andExpect(jsonPath("$.files[0].analysisIncluded").value(true))
                .andExpect(jsonPath("$.files[1].analysisIncluded").value(false));
    }

    @Test
    void promptBudgetExceededReturnsCorrectHttpStatus() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "budget.wotbreplay", "budget-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any()))
                .thenThrow(new AiPromptBudgetExceededException());

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("budget.wotbreplay")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("AI_PROMPT_MANDATORY_SECTION_TOO_LARGE"));
    }

    @Test
    void missingAiConfigurationReturnsStable503Error() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "config.wotbreplay", "config-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any()))
                .thenThrow(new AiNotConfiguredException());

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("config.wotbreplay")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().string("AI_NOT_CONFIGURED"));
    }

    @Test
    void upstreamFailureReturnsOnlyStableCode() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "rate.wotbreplay", "rate-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any()))
                .thenThrow(new AiUpstreamException(
                        "AI_RATE_LIMITED", 429, "private-correlation-id"));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("rate.wotbreplay")))
                .andExpect(status().isBadGateway())
                .andExpect(content().string("AI_RATE_LIMITED"));
    }

    @Test
    void randomBattleKeepsPlayerFocusedPath() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(randomResult());
        when(aiService.analyzePlayerOrFallback(any()))
                .thenReturn(new AiReplayAnalysisService.AnalyzeResult(
                        "player review", "test-model", List.of()));

        mvc.perform(multipart("/api/replay/analyze")
                        .file(replayFile("random.wotbreplay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("SINGLE_PLAYER_BATTLE"))
                .andExpect(jsonPath("$.analysis").value("player review"))
                .andExpect(jsonPath("$.files[0].battleCategory").value("RANDOM"))
                .andExpect(jsonPath("$.files[0].analysisScope").value("PLAYER_FOCUSED"));

        verify(aiService).analyzePlayerOrFallback(any());
        verify(aiService, never()).analyzeTeamGroups(any());
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static ArgumentCaptor<List<ReplayPerspectiveGroup>> teamGroupCaptor() {
        return (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
    }

    private static AiReplayAnalysisService.TeamAnalyzeResult teamAiResult(
            final String analysis,
            final List<AnalysisUnitResult> units
    ) {
        return new AiReplayAnalysisService.TeamAnalyzeResult(
                new AiReplayAnalysisService.AnalyzeResult(
                        analysis, "test-model", List.of()),
                units,
                units.size(),
                units.size(),
                0,
                List.of());
    }

    private static AnalysisUnitResult unit(
            final String unitId,
            final String arenaId,
            final int perspectiveTeam,
            final String fileName
    ) {
        return new AnalysisUnitResult(
                unitId,
                new BattleIdentity(arenaId, "team_map", "11.0", null),
                ReplayAnalysisScope.TEAM_PERSPECTIVE,
                perspectiveTeam,
                fileName,
                List.of(),
                "test-model",
                Map.of("fullFeaturesAvailable", false));
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
}
