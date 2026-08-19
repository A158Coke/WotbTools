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
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.AnalyzeResult;
import com.wotb.web.replay.ai.TeamAnalyzeResult;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 团队复盘（训练房/联赛）契约：异步 worker 下成功路径 done 事件携带 analysis；
 * request-envelope 校验（文件数/空文件等）在提交 worker 前失败 → HTTP 400，
 * 不进入 SSE 流；worker 内的运行时/业务失败（视角未解析/视角冲突/特征不可用/
 * 预算/未配置/上游失败）→ SSE {@code error} 事件携带稳定错误码（HTTP 已 200）。
 */
class ReconstructionControllerTeamAnalysisTest {

    private DefaultReplayProcessingFacade processingFacade;
    private AiReplayAnalysisService aiService;
    private AiReplayReviewService reviewService;
    private AiReviewWorkerExecutor workerExecutor;
    private ReconstructionController controller;

    @BeforeEach
    void setUp() {
        processingFacade = mock(DefaultReplayProcessingFacade.class);
        aiService = mock(AiReplayAnalysisService.class);
        reviewService = spy(new AiReplayReviewService(processingFacade, aiService));
        workerExecutor = new AiReviewWorkerExecutor();
        controller = new ReconstructionController(processingFacade, reviewService, new AiCancellationRegistry(), workerExecutor, new MapOverviewQueryService(processingFacade), null);
    }

    @AfterEach
    void tearDown() {
        workerExecutor.close();
    }

    @Test
    void uploadWithTwoFilesThrowsReplayFileCountExceededBeforeStreamStarts() throws Exception {
        // HTTP request-envelope validation：2 文件超 MAX_FILES=1 → 提交 worker 前抛
        // ReplayFileCountExceededException → @ExceptionHandler 映射 400 结构化
        // {code, maxFiles, actualFiles}，不进入 SSE 流。
        assertThrows(ReplayFileCountExceededException.class,
                () -> controller.analyze(
                        new MultipartFile[]{replayFile("a.wotbreplay"), replayFile("b.wotbreplay")},
                        "zh", null));
        // Processing facade and AI provider must not be called
        verify(processingFacade, never()).process(any(Source.class), any(ReplayProcessingOptions.class));
        verify(aiService, never()).analyzeTeamGroups(any(), any(), any());
        verify(aiService, never()).analyzePlayerOrFallback(any(), any(), any());
        verify(reviewService, never()).analyzeStreaming(any(), any(), any());
    }

    @Test
    void uploadWithTwoIdenticalFilesAlsoRejectedByCountBeforeStreamStarts() throws Exception {
        final var file = replayFile("same.wotbreplay");
        assertThrows(ReplayFileCountExceededException.class,
                () -> controller.analyze(new MultipartFile[]{file, file}, "zh", null));
        verify(processingFacade, never()).process(any(Source.class), any(ReplayProcessingOptions.class));
        verify(reviewService, never()).analyzeStreaming(any(), any(), any());
    }

    @Test
    void emptyFilesArrayThrowsNoReplayFilesBeforeStreamStarts() throws Exception {
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyze(new MultipartFile[0], "zh", null));
        verify(processingFacade, never()).process(any(Source.class), any(ReplayProcessingOptions.class));
        verify(aiService, never()).analyzeTeamGroups(any(), any(), any());
        verify(reviewService, never()).analyzeStreaming(any(), any(), any());
    }

    @Test
    void trainingReplayUsesSingleTeamAnalysis() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "training.wotbreplay", "arena-one", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenReturn(teamAiResult("team review"));

        final String body = drainUntilDone(analyzeDirect(replayFile("training.wotbreplay")));

        assertTrue(body.contains("\"analysis\":\"team review") && body.contains("AI复盘仅供参考"),
                "analysis must keep text and end with disclaimer footer: " + body);

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService).analyzeTeamGroups(captor.capture(), any(), any());
        assertEquals(1, captor.getValue().size());
        assertEquals(1, captor.getValue().getFirst().key().perspectiveTeam());
        verify(aiService, never()).analyzePlayerOrFallback(any(), any(), any());
    }

    @Test
    void singleTeamUploadAnalyzesOnce() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "single.wotbreplay", "test-arena", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenReturn(teamAiResult("single review"));

        drainUntilDone(analyzeDirect(replayFile("single.wotbreplay")));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService, times(1)).analyzeTeamGroups(captor.capture(), any(), any());
        assertEquals(1, captor.getValue().size());
        verify(aiService, never()).analyzePlayerOrFallback(any(), any(), any());
    }

    @Test
    void singleTeamUsesMultiTeamAnalysis() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "team.wotbreplay", "team-arena", "Player", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenReturn(teamAiResult("team review"));

        drainUntilDone(analyzeDirect(replayFile("team.wotbreplay")));

        final ArgumentCaptor<List<ReplayPerspectiveGroup>> captor =
                teamGroupCaptor();
        verify(aiService).analyzeTeamGroups(captor.capture(), any(), any());
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
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenReturn(teamAiResult("fallback review"));

        final String body = drainUntilDone(analyzeDirect(replayFile("fallback.wotbreplay")));

        assertTrue(body.contains("\"analysis\":\"fallback review") && body.contains("AI复盘仅供参考"), body);
    }

    @Test
    void teamAnalysisResponseContainsOnlyText() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "training.wotbreplay", "arena-one", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenReturn(new TeamAnalyzeResult(new AnalyzeResult("team review")));

        final String body = drainUntilDone(analyzeDirect(replayFile("training.wotbreplay")));

        assertTrue(body.contains("\"analysis\":\"team review") && body.contains("AI复盘仅供参考"), body);
    }

    @Test
    void singleBattleTeamAnalysis() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "battle.wotbreplay", "battle-arena", "Player", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenReturn(teamAiResult("team review"));

        final String body = drainUntilDone(analyzeDirect(replayFile("battle.wotbreplay")));

        assertTrue(body.contains("\"analysis\":\"team review") && body.contains("AI复盘仅供参考"), body);
    }

    @Test
    void unresolvedPerspectiveConveysStableErrorEvent() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(unresolvedTeamResult());

        final String body = analyzeConveyingError(replayFile("observer.wotbreplay"));

        assertTrue(body.contains("\"code\":\"PERSPECTIVE_TEAM_UNRESOLVED\""), body);
        verify(aiService, never()).analyzeTeamGroups(any(), any(), any());
    }

    @Test
    void conflictingPerspectiveConveysSpecificStableErrorEvent() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(conflictingTeamResult());

        final String body = analyzeConveyingError(replayFile("conflict.wotbreplay"));

        assertTrue(body.contains("\"code\":\"PERSPECTIVE_TEAM_CONFLICT\""), body);
        verify(aiService, never()).analyzeTeamGroups(any(), any(), any());
    }

    @Test
    void resolvedTeamWithoutSummaryOrMappedFeaturesConveysStableErrorEvent()
            throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(resolvedTeamWithoutFeatures());

        final String body = analyzeConveyingError(replayFile("no-features.wotbreplay"));

        assertTrue(body.contains("\"code\":\"TEAM_FEATURES_UNAVAILABLE\""), body);
        verify(aiService, never()).analyzeTeamGroups(any(), any(), any());
    }

    @Test
    void resolvedTeamAnalysisReturnsOk() throws Exception {
        final ReplayProcessingResult result = teamResult(
                "resolved.wotbreplay", "resolved-arena", "Ally", 1001L, 1);
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(result);
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenReturn(teamAiResult("review"));

        final String body = drainUntilDone(analyzeDirect(replayFile("resolved.wotbreplay")));

        assertTrue(body.contains("\"analysis\":\"review") && body.contains("AI复盘仅供参考"), body);
    }

    @Test
    void promptBudgetExceededConveysStableErrorEvent() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "budget.wotbreplay", "budget-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenThrow(new AiPromptBudgetExceededException());

        final String body = analyzeConveyingError(replayFile("budget.wotbreplay"));

        assertTrue(body.contains("\"code\":\"AI_PROMPT_MANDATORY_SECTION_TOO_LARGE\""), body);
    }

    @Test
    void missingAiConfigurationConveysStableErrorEvent() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "config.wotbreplay", "config-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenThrow(new AiNotConfiguredException());

        final String body = analyzeConveyingError(replayFile("config.wotbreplay"));

        assertTrue(body.contains("\"code\":\"AI_NOT_CONFIGURED\""), body);
    }

    @Test
    void upstreamFailureConveysOnlyStableCode() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(teamResult(
                        "rate.wotbreplay", "rate-arena", "Ally", 1001L, 1));
        when(aiService.analyzeTeamGroups(any(), any(), any()))
                .thenThrow(new AiUpstreamException(
                        "AI_RATE_LIMITED", 429, "private-correlation-id"));

        final String body = analyzeConveyingError(replayFile("rate.wotbreplay"));

        assertTrue(body.contains("\"code\":\"AI_RATE_LIMITED\""), body);
    }

    @Test
    void randomBattleKeepsPlayerFocusedPath() throws Exception {
        when(processingFacade.process(any(Source.class), any(ReplayProcessingOptions.class)))
                .thenReturn(randomResult());
        when(aiService.analyzePlayerOrFallback(any(), any(), any()))
                .thenReturn(new AnalyzeResult("player review"));

        final String body = drainUntilDone(analyzeDirect(replayFile("random.wotbreplay")));

        assertTrue(body.contains("\"analysis\":\"player review") && body.contains("AI复盘仅供参考"), body);

        verify(aiService).analyzePlayerOrFallback(any(), any(), any());
        verify(aiService, never()).analyzeTeamGroups(any(), any(), any());
    }

    @Test
    void blankLangThrowsUnknownLocaleBeforeStreamStarts() {
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyze(
                        new MultipartFile[]{replayFile("a.wotbreplay")}, "", null));
        verify(aiService, never()).analyzePlayerOrFallback(any(), any(), any());
    }

    @Test
    void unknownLangThrowsUnknownLocaleBeforeStreamStarts() {
        assertThrows(IllegalArgumentException.class,
                () -> controller.analyze(
                        new MultipartFile[]{replayFile("a.wotbreplay")}, "fr", null));
        verify(aiService, never()).analyzePlayerOrFallback(any(), any(), any());
    }

    @Test
    void langEnIsForwardedToReviewService() throws Exception {
        doReturn(new AnalyzeResponse("ok"))
                .when(reviewService).analyzeStreaming(any(), any(AllowedLanguage.class), any());
        drainUntilDone(analyzeDirect(replayFile("a.wotbreplay"), "en"));
        verify(reviewService).analyzeStreaming(any(), eq(AllowedLanguage.EN), any());
    }

    @Test
    void langRuIsForwardedToReviewService() throws Exception {
        doReturn(new AnalyzeResponse("ok"))
                .when(reviewService).analyzeStreaming(any(), any(AllowedLanguage.class), any());
        drainUntilDone(analyzeDirect(replayFile("a.wotbreplay"), "ru"));
        verify(reviewService).analyzeStreaming(any(), eq(AllowedLanguage.RU), any());
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

    // ---- helpers ----

    private ReconstructionControllerTestEmitter analyzeDirect(final MockMultipartFile file) {
        return analyzeDirect(file, "zh");
    }

    private ReconstructionControllerTestEmitter analyzeDirect(final MockMultipartFile file,
                                                              final String lang) {
        final ReconstructionControllerTestEmitter emitter =
                new ReconstructionControllerTestEmitter();
        final ReconstructionController controllerSpy = spy(controller);
        doReturn(emitter).when(controllerSpy).newAnalyzeEmitter();
        controllerSpy.analyze(new MultipartFile[]{file}, lang, null);
        return emitter;
    }

    /**
     * 断言 worker 通过 error 事件传达稳定错误码（而非 HTTP 状态码）。
     */
    private String analyzeConveyingError(final MockMultipartFile file) throws InterruptedException {
        final String body = drainUntilMarker(analyzeDirect(file), "event:error");
        assertTrue(body.contains("event:error"), body);
        assertTrue(!body.contains("event:done"), "failed stream must not emit done: " + body);
        return body;
    }

    private String drainUntilDone(final ReconstructionControllerTestEmitter emitter)
            throws InterruptedException {
        final String body = drainUntilMarker(emitter, "event:done");
        assertTrue(body.contains("event:done"),
                "stream must complete with done: " + body);
        return body;
    }

    /**
     * 轮询事件队列直到包含 marker（或超时），返回已收集的事件文本。
     */
    private String drainUntilMarker(final ReconstructionControllerTestEmitter emitter,
                                    final String marker) throws InterruptedException {
        final StringBuilder body = new StringBuilder();
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            final String event = emitter.awaitEvent(
                    Math.max(1, (deadline - System.nanoTime()) / 1_000_000),
                    TimeUnit.MILLISECONDS);
            if (event == null) {
                break;
            }
            body.append(event);
            if (event.contains(marker)) {
                break;
            }
        }
        return body.toString();
    }

    private static final class ReconstructionControllerTestEmitter
            extends ReconstructionControllerStreamingTest.RecordingEmitter {

        ReconstructionControllerTestEmitter() {
            super(ReconstructionController.SSE_TIMEOUT_MS);
        }
    }
}
