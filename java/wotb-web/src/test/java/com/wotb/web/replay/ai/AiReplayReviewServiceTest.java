package com.wotb.web.replay.ai;

import java.io.IOException;
import java.util.List;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AiReplayReviewServiceTest {

    @Mock
    private DefaultReplayProcessingFacade processingFacade;

    @Mock
    private AiReplayAnalysisService aiAnalysisService;

    private AiReplayReviewService service;

    @BeforeEach
    void setUp() {
        service = new AiReplayReviewService(processingFacade, aiAnalysisService);
    }

    @Test
    void nullBatchThrowsIllegalArgument() {
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(null));
        assertEquals("NO_REPLAY_FILES", ex.getMessage());
    }

    @Test
    void twoFilesThrowsReplayFileCountExceeded() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "a.wotbreplay",
                        "application/octet-stream", new byte[]{1}),
                new MockMultipartFile("files", "b.wotbreplay",
                        "application/octet-stream", new byte[]{1})
        };
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.analyze(files));
    }

    @Test
    void invalidExtensionThrowsIllegalArgument() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "file.txt",
                        "application/octet-stream", new byte[]{1})
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("INVALID_REPLAY_FILE_TYPE", ex.getMessage());
    }

    @Test
    void emptyFileThrowsIllegalArgument() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "empty.wotbreplay",
                        "application/octet-stream", new byte[0])
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("NO_REPLAY_FILE", ex.getMessage());
    }

    @Test
    void fileTooLargeThrowsIllegalArgument() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "big.wotbreplay",
                        "application/octet-stream", new byte[21 * 1024 * 1024])
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("FILE_TOO_LARGE", ex.getMessage());
    }

    @Test
    void emptyArrayThrowsNoReplayFiles() {
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MockMultipartFile[0]));
        assertEquals("NO_REPLAY_FILES", ex.getMessage());
    }

    @Test
    void nullElementThrowsNoReplayFile() {
        final var files = new MockMultipartFile[]{null};
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("NO_REPLAY_FILE", ex.getMessage());
    }

    @Test
    void singleFileTotalSizeIsSameAsFileSize() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("valid.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(20L * 1024 * 1024);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void blankFilenameThrowsInvalidReplayFileType() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("   ");
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("INVALID_REPLAY_FILE_TYPE", ex.getMessage());
    }

    @Test
    void nullFilenameThrowsInvalidReplayFileType() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn(null);
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("INVALID_REPLAY_FILE_TYPE", ex.getMessage());
    }

    @Test
    void uppercaseExtensionIsAccepted() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("TEST.WOTBREPLAY");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1L);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void exactMaxFileSizeIsAccepted() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("valid.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(20L * 1024 * 1024);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void exceedsMaxFileSizeThrows() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("big.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(20L * 1024 * 1024 + 1);
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("FILE_TOO_LARGE", ex.getMessage());
    }

    @Test
    void singleFileExactMaxFileSizeIsAccepted() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("valid.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1L);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void oneFileIsAccepted() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("single.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1L);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void twoFilesExceededDoesNotCallGetBytes() throws IOException {
        final var files = new MultipartFile[]{
                mock(MultipartFile.class),
                mock(MultipartFile.class)
        };
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.analyze(files));
        verify(files[0], never()).getBytes();
        verify(files[1], never()).getBytes();
    }

    @Test
    void twoFilesExceededDoesNotCallProcessingFacade() throws IOException {
        final var files = new MultipartFile[]{
                mock(MultipartFile.class),
                mock(MultipartFile.class)
        };
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.analyze(files));
        verify(processingFacade, never()).process(any(), any());
    }

    // ---- Call #1 preBattleSection 渲染（SINGLE_PLAYER_BATTLE harness 路径） ----

    private static final PreBattleStrategicPrior PRIOR = new PreBattleStrategicPrior(
            new PreBattleStrategicPrior.TeamProfile(
                    java.util.Map.of("mobility", "HIGH"),
                    List.of("重坦正面推进"),
                    List.of("转场慢"),
                    List.of("左路集结")),
            new PreBattleStrategicPrior.TeamProfile(
                    java.util.Map.of(),
                    List.of("中坦机动拉扯"),
                    List.of(),
                    List.of()),
            List.of(new PreBattleStrategicPrior.KeyMatchup(
                    "GRID_REGION_5", "TEAM_A", "正面火力占优")),
            List.of(new PreBattleStrategicPrior.StrategicWinCondition(
                    "TEAM_A", "前十分钟控制左路")),
            List.of(new PreBattleStrategicPrior.StrategicHypothesis(
                    "H1", "开局左路集结", "地图出生点偏左")));

    private static ReplayProcessingResult randomResult() {
        final Battle battle = new Battle();
        battle.arenaId = "random-arena";
        battle.mapName = "random_map";
        battle.arenaBonusType = 1;
        battle.recorder = "Player";
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = 1001L;
        recorder.nickname = "Player";
        recorder.team = 1;
        recorder.damageDealt = 1_000;
        battle.players = List.of(recorder);
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        return new ReplayProcessingResult(
                "random.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("h", "random-arena", "11.0", "random_map", 1001L, null),
                battle, null, null, capabilities, null, null);
    }

    private MockMultipartFile singleFile() {
        return new MockMultipartFile("files", "a.wotbreplay",
                "application/octet-stream", new byte[]{1});
    }

    private void stubRandomProcessing() throws IOException {
        when(processingFacade.process(any(), any())).thenReturn(randomResult());
    }

    @Test
    void harnessPathRendersPreBattleSectionWhenPriorAvailable() throws IOException {
        final TacticalReviewHarness harness = mock(TacticalReviewHarness.class);
        when(harness.analyzeWithPrior(any(), eq(AllowedLanguage.ZH), any())).thenReturn(
                new TacticalReviewHarness.HarnessOutcome(
                        new AnalyzeResult("harness-text"), PRIOR));
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness);
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertEquals("harness-text", response.analysis(), "analysis must be unaffected");
        final String section = response.preBattleSection();
        assertNotNull(section, "Call #1 prior must be rendered when harness succeeds");
        assertTrue(section.contains("赛前预测"), "section must be user-visible Chinese");
        assertTrue(section.contains("队伍1画像"), "neutral team labels for random battles");
        assertTrue(section.contains("重坦正面推进"));
        assertFalse(section.contains("PRE-BATTLE"), "machine section header must be removed");
        assertFalse(section.contains("TEAM_A"), "internal team tokens must be replaced");
    }

    @Test
    void harnessPathNullSectionWhenPriorUnavailable() throws IOException {
        final TacticalReviewHarness harness = mock(TacticalReviewHarness.class);
        when(harness.analyzeWithPrior(any(), eq(AllowedLanguage.ZH), any())).thenReturn(
                new TacticalReviewHarness.HarnessOutcome(
                        new AnalyzeResult("harness-text"), null));
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness);
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertEquals("harness-text", response.analysis());
        assertNull(response.preBattleSection(),
                "failed Call #1 / fallback must yield null preBattleSection");
    }

    @Test
    void nonZhRequestYieldsNullPreBattleSection() throws IOException {
        final TacticalReviewHarness harness = mock(TacticalReviewHarness.class);
        // 非 ZH 时 harness 内部走 fallback，不产出 prior（契约由 Harness 保证）
        when(harness.analyzeWithPrior(any(), eq(AllowedLanguage.EN), any())).thenReturn(
                new TacticalReviewHarness.HarnessOutcome(
                        new AnalyzeResult("fallback-text"), null));
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness);
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(
                new MultipartFile[]{singleFile()}, AllowedLanguage.EN);

        assertEquals("fallback-text", response.analysis());
        assertNull(response.preBattleSection());
    }

    @Test
    void noHarnessFallbackKeepsNullSection() throws IOException {
        when(aiAnalysisService.analyzePlayerOrFallback(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new AnalyzeResult("fallback-text"));
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertEquals("fallback-text", response.analysis());
        assertNull(response.preBattleSection(),
                "old path has no Call #1 prior, section must stay null");
    }

    @Test
    void analyzeResponseSerializesNullPreBattleSection() throws Exception {
        final String json = JsonMapper.builder().build()
                .writeValueAsString(new AnalyzeResponse("ok"));
        assertTrue(json.contains("\"analysis\":\"ok\""),
                "analysis must serialize: " + json);
        assertTrue(json.contains("\"preBattleSection\":null"),
                "null preBattleSection must serialize without error: " + json);
    }

    @Test
    void analyzeStreamingForwardsStageAndTokenEventsToListener() throws IOException {
        final TacticalReviewHarness harness = mock(TacticalReviewHarness.class);
        when(harness.analyzeWithPrior(any(), eq(AllowedLanguage.ZH), any())).thenAnswer(
                invocation -> {
                    final AiReviewStreamListener listener = invocation.getArgument(2);
                    listener.onStage("call1_start");
                    listener.onStage("call1_done");
                    listener.onStage("evidence_done");
                    listener.onToken("harness");
                    listener.onToken("-text");
                    return new TacticalReviewHarness.HarnessOutcome(
                            new AnalyzeResult("harness-text"), PRIOR);
                });
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness);
        stubRandomProcessing();

        final StringBuilder events = new StringBuilder();
        final AnalyzeResponse response = service.analyzeStreaming(
                new MultipartFile[]{singleFile()}, AllowedLanguage.ZH,
                new AiReviewStreamListener() {
                    @Override
                    public void onStage(final String stage) {
                        events.append(stage).append(';');
                    }

                    @Override
                    public void onToken(final String delta) {
                        events.append("token:").append(delta).append(';');
                    }
                });

        assertEquals("call1_start;call1_done;evidence_done;token:harness;token:-text;",
                events.toString(), "stage and token events must be forwarded in order");
        assertEquals("harness-text", response.analysis());
        assertNotNull(response.preBattleSection());
    }

    @Test
    void randomBattleWithResolvedRecorderTeamDoesNotShowNicknameAsTeamLabel() throws IOException {
        // 随机战 recorder team 已解析为 1（reconstruction 有 recorder participant）：
        // 渲染为「友军画像/敌军画像」，不附加录像者 nickname 作为 team label。
        final TacticalReviewHarness harness = mock(TacticalReviewHarness.class);
        when(harness.analyzeWithPrior(any(), eq(AllowedLanguage.ZH), any())).thenReturn(
                new TacticalReviewHarness.HarnessOutcome(
                        new AnalyzeResult("harness-text"), PRIOR));
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness);
        when(processingFacade.process(any(), any())).thenReturn(randomResultWithReconstruction());

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertEquals("harness-text", response.analysis());
        final String section = response.preBattleSection();
        assertNotNull(section, "preBattleSection must be rendered when prior is available");
        assertTrue(section.contains("友军画像"),
                "random battle with recorderTeam=1 must show 友军画像 without recorder nickname");
        assertTrue(section.contains("敌军画像"));
        assertFalse(section.contains("Player123"),
                "recorder nickname must not appear as team label in random battle");
    }

    private static ReplayProcessingResult randomResultWithReconstruction() {
        final Battle battle = new Battle();
        battle.arenaId = "random-arena";
        battle.mapName = "random_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = "Player123";
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = 1001L;
        recorder.nickname = "Player123";
        recorder.team = 1;
        recorder.damageDealt = 1_000;
        recorder.survived = true;
        battle.players = List.of(recorder);
        final ReplayReconstruction reconstruction = new ReplayReconstruction(
                null, null, 300f, null,
                List.of(new BattleParticipant(1001L, "Player123", 1, 1, "tank", true)),
                List.of(), List.of(), null, null, null);
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, false, false, false);
        return new ReplayProcessingResult(
                "random.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("h", "random-arena", "11.0", "random_map", 1001L, null),
                battle, reconstruction, null, capabilities, null, null);
    }

}
