package com.wotb.web.replay.ai;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;

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
    void sanitizeClusterTermsProtectsRosterProperNounsInBothSections() {
        // 权威昵称「星簇」在 analysis 与 preBattleSection 两段都必须原样保留；
        // AI 内部术语「主力簇」确定性转为「主力集群」。
        final Battle battle = new Battle();
        final PlayerResult p = new PlayerResult();
        p.accountId = 1L;
        p.team = 1;
        p.tankId = 4481L; // Kranvagn
        p.nickname = "星簇";
        p.tankName = "Kranvagn";
        battle.players = List.of(p);
        final List<String> corrected = AiReplayReviewService.sanitizeClusterTerms(
                List.of("星簇（Kranvagn）随主力簇推进", "预判星簇会主力簇压向中路"),
                battle);
        assertEquals("星簇（Kranvagn）随主力集群推进", corrected.get(0));
        assertEquals("预判星簇会主力集群压向中路", corrected.get(1));
        for (final String section : corrected) {
            assertTrue(section.contains("星簇"), "权威昵称必须保留: " + section);
            assertFalse(section.contains("星群"), "昵称不得被单字兜底改写成星群");
            assertFalse(section.contains("主力簇"), "内部术语必须转换: " + section);
        }
    }

    @Test
    void preBattleRendererThenServiceSanitizerKeepsProperNouns() {
        // 真实生产调用顺序：PreBattleStrategicPrior → PreBattleSectionRenderer.render
        // （teamLabel=星簇，renderer 不再提前裸替换「簇」）→ correctTankNames（本文本已是权威名，
        // 等价 no-op）→ sanitizeClusterTerms（带 protected literals：nickname/tankName/clan）。
        final Battle battle = new Battle();
        final PlayerResult p = new PlayerResult();
        p.accountId = 1L;
        p.team = 1;
        p.tankId = 4481L; // Kranvagn
        p.nickname = "星簇";
        p.tankName = "Kranvagn";
        p.clan = "星簇";
        battle.players = List.of(p);

        final PreBattleStrategicPrior prior = new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of(),
                        List.of("星簇（Kranvagn）随主力簇推进"),
                        List.of(),
                        List.of()),
                null,
                List.of(new PreBattleStrategicPrior.KeyMatchup(
                        "GRID_REGION_5", "TEAM_A", "星簇会主力簇推进")),
                List.of(),
                List.of());
        final String rendered = PreBattleSectionRenderer.render(
                prior, 1, "星簇", AllowedLanguage.ZH, "neptune");
        final List<String> corrected = AiReplayReviewService.sanitizeClusterTerms(
                List.of(rendered, "星簇（Kranvagn）随主力簇推进"), battle);
        // preBattleSection（renderer 输出）：昵称/坦克名/teamLabel(clan) 保留，内部术语转换
        final String pre = corrected.get(0);
        assertTrue(pre.contains("星簇"), "权威昵称/teamLabel 必须保留: " + pre);
        assertFalse(pre.contains("星群"), "不得改写成星群: " + pre);
        assertTrue(pre.contains("Kranvagn"), "权威坦克名必须保留: " + pre);
        assertTrue(pre.contains("主力集群"), "内部术语必须转换: " + pre);
        assertFalse(pre.contains("主力簇"), "内部术语不得残留: " + pre);
        // analysis 段同样保留
        final String analysis = corrected.get(1);
        assertTrue(analysis.contains("星簇"), analysis);
        assertFalse(analysis.contains("星群"), analysis);
        // null preBattleSection 不回归
        final List<String> withNull = AiReplayReviewService.sanitizeClusterTerms(
                java.util.Arrays.asList("主力簇推进", null), battle);
        assertNull(withNull.get(1));
        assertTrue(withNull.get(0).contains("主力集群"), withNull.get(0));
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
        when(file.getSize()).thenReturn(ReplayUploadValidator.MAX_FILE_SIZE);
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
        when(file.getSize()).thenReturn(ReplayUploadValidator.MAX_FILE_SIZE);
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
        when(file.getSize()).thenReturn(ReplayUploadValidator.MAX_FILE_SIZE + 1);
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
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("a.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1L);
        final var files = new MultipartFile[]{
                file, file
        };
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.analyze(files));
        verify(files[0], never()).getBytes();
        verify(files[1], never()).getBytes();
    }

    @Test
    void twoFilesExceededDoesNotCallProcessingFacade() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("a.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1L);
        final var files = new MultipartFile[]{
                file, file
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
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness, null, null);
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("harness-text"),
                "analysis text must be preserved before footer");
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"),
                "ZH analysis must end with fixed disclaimer footer");
        final String section = response.preBattleSection();
        assertNotNull(section, "Call #1 prior must be rendered when harness succeeds");
        assertTrue(section.contains("赛前预测"), "section must be user-visible Chinese");
        assertTrue(section.contains("队伍1画像"), "neutral team labels for random battles");
        assertTrue(section.contains("重坦正面推进"));
        assertFalse(section.contains("PRE-BATTLE"), "machine section header must be removed");
        assertFalse(section.contains("TEAM_A"), "internal team tokens must be replaced");
    }

    // ---- plan §36–§38/§87：Dataset 路径只读 ai-facts，不得调用 processingFacade ----

    @Test
    void analyzeFactsFromDatasetReadsArtifactWithoutProcessingFacade() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-ai-dataset-test");
        final ReplayProcessingJobStore store = new ReplayProcessingJobStore(dir, 60);
        try {
            final ReplayProcessingResult result = randomResult();
            final ReplayProcessingJob job = new ReplayProcessingJob("j1", List.of("a.wotbreplay"));
            job.startProcessing();
            job.markSourceProcessing(0, "a.wotbreplay");
            ReplayArtifactWriter.writeAiFacts(store.jobDir("j1"), 0, result);
            job.markSourceReady(0);
            job.updateProgress(1, 0, 0);
            job.markReady(new ProcessedDataset(List.of(result.battle()), List.of("a.wotbreplay"),
                    List.of(), List.of(), null, null));
            store.register(job);
            service = new AiReplayReviewService(
                    processingFacade, aiAnalysisService, null, null, null, store);
            when(aiAnalysisService.analyzePlayerOrFallback(any(), eq(AllowedLanguage.ZH), any()))
                    .thenReturn(new AnalyzeResult("dataset-analysis"));

            final AnalyzeResponse response =
                    service.analyzeFacts("j1", 0, AllowedLanguage.ZH, AiReviewStreamListener.NOOP);

            assertNotNull(response);
            assertTrue(response.analysis().contains("dataset-analysis"));
            verify(processingFacade, never()).process(any(), any());
        } finally {
            store.close();
            try (var walk = Files.walk(dir)) {
                walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                    try {
                        Files.deleteIfExists(p);
                    } catch (final Exception ignored) {
                        // best-effort test cleanup
                    }
                });
            }
        }
    }

    @Test
    void harnessPathNullSectionWhenPriorUnavailable() throws IOException {
        final TacticalReviewHarness harness = mock(TacticalReviewHarness.class);
        when(harness.analyzeWithPrior(any(), eq(AllowedLanguage.ZH), any())).thenReturn(
                new TacticalReviewHarness.HarnessOutcome(
                        new AnalyzeResult("harness-text"), null));
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness, null, null);
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("harness-text"));
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"));
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
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness, null, null);
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(
                new MultipartFile[]{singleFile()}, AllowedLanguage.EN);

        assertTrue(response.analysis().startsWith("fallback-text"));
        assertTrue(response.analysis().endsWith("This AI review is for reference only"),
                "EN analysis must end with English disclaimer footer");
        assertNull(response.preBattleSection());
    }

    @Test
    void noHarnessFallbackKeepsNullSection() throws IOException {
        when(aiAnalysisService.analyzePlayerOrFallback(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new AnalyzeResult("fallback-text"));
        stubRandomProcessing();

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("fallback-text"));
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"));
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
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness, null, null);
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
        assertTrue(response.analysis().startsWith("harness-text"));
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"));
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
        service = new AiReplayReviewService(processingFacade, aiAnalysisService, harness, null, null);
        when(processingFacade.process(any(), any())).thenReturn(randomResultWithReconstruction());

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("harness-text"));
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"));
        final String section = response.preBattleSection();
        assertNotNull(section, "preBattleSection must be rendered when prior is available");
        assertTrue(section.contains("友军画像"),
                "random battle with recorderTeam=1 must show 友军画像 without recorder nickname");
        assertTrue(section.contains("敌军画像"));
        assertFalse(section.contains("Player123"),
                "recorder nickname must not appear as team label in random battle");
    }

    @Test
    void fallbackPathCorrectsHallucinatedTankName() throws IOException {
        when(aiAnalysisService.analyzePlayerOrFallback(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new AnalyzeResult("1分07秒：CHRD的埃米尔1951（Awesomeman954）!紧接着阵亡"));
        when(processingFacade.process(any(), any())).thenReturn(randomBattleResult(
                "random-arena", 1, List.of(player("Awesomeman954", 1001L, 1, 4481))));

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("1分07秒：CHRD的Kranvagn（Awesomeman954）!紧接着阵亡"),
                "hallucinated EMIL 1951 must be corrected to roster Kranvagn");
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"));
        assertFalse(response.analysis().contains("埃米尔1951"));
    }

    @Test
    void teamBranchCorrectsTankNamesInAnalysisAndPreBattleSection() throws IOException {
        when(aiAnalysisService.analyzeTeamGroups(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new TeamAnalyzeResult(
                        new AnalyzeResult("1分07秒：CHRD的埃米尔1951（Awesomeman954）阵亡"),
                        "赛前：Awesomeman954（埃米尔1951）带队"));
        when(processingFacade.process(any(), any())).thenReturn(randomBattleResult(
                "team-arena", 2, List.of(
                        player("Awesomeman954", 1001L, 1, 4481),
                        player("A158布丁", 2001L, 2, 6929))));

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("1分07秒：CHRD的Kranvagn（Awesomeman954）阵亡"),
                "analysis tank names must be roster-authoritative");
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"));
        assertEquals("赛前：Awesomeman954（Kranvagn）带队", response.preBattleSection(),
                "preBattleSection tank names must be roster-authoritative");
    }

    // ---- package 传播：analysis + preBattleSection 共享同一份 anchor 证明 ----

    @Test
    void packagePropagation_analysisAnchor_preBattleStandalone() throws IOException {
        when(aiAnalysisService.analyzeTeamGroups(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new TeamAnalyzeResult(
                        new AnalyzeResult("埃米尔1951（Awesomeman954）阵亡"),
                        "赛前：埃米尔1951负责正面推进"));
        when(processingFacade.process(any(), any())).thenReturn(randomBattleResult(
                "team-arena", 2, List.of(
                        player("Awesomeman954", 1001L, 1, 4481),
                        player("A158布丁", 2001L, 2, 6929))));

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("Kranvagn（Awesomeman954）阵亡"),
                "analysis anchored mention must be corrected");
        assertTrue(response.analysis().endsWith("AI复盘仅供参考"));
        assertEquals("赛前：Kranvagn负责正面推进", response.preBattleSection(),
                "preBattle standalone must be corrected via shared package propagation");
        assertFalse(response.analysis().contains("埃米尔1951"));
        assertFalse(response.analysis().contains("EMIL 1951"));
        assertFalse(response.preBattleSection().contains("埃米尔1951"));
        assertFalse(response.preBattleSection().contains("EMIL 1951"));
    }

    @Test
    void packagePropagation_preBattleAnchor_analysisStandalone() throws IOException {
        when(aiAnalysisService.analyzeTeamGroups(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new TeamAnalyzeResult(
                        new AnalyzeResult("EMIL 1951 前压顶线"),
                        "赛前：埃米尔1951（Awesomeman954）带队"));
        when(processingFacade.process(any(), any())).thenReturn(randomBattleResult(
                "team-arena", 2, List.of(
                        player("Awesomeman954", 1001L, 1, 4481),
                        player("A158布丁", 2001L, 2, 6929))));

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("Kranvagn 前压顶线"),
                "analysis standalone must be corrected via preBattle anchor proof");
        assertEquals("赛前：Kranvagn（Awesomeman954）带队", response.preBattleSection());
    }

    @Test
    void packagePropagation_conflictingAnchors_standaloneFailClosed() throws IOException {
        when(aiAnalysisService.analyzeTeamGroups(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new TeamAnalyzeResult(
                        new AnalyzeResult("埃米尔1951（Awesomeman954）阵亡。埃米尔1951前压。"),
                        "赛前：埃米尔1951（A158布丁）带队"));
        when(processingFacade.process(any(), any())).thenReturn(randomBattleResult(
                "team-arena", 2, List.of(
                        player("Awesomeman954", 1001L, 1, 4481),
                        player("A158布丁", 2001L, 2, 6929))));

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("Kranvagn（Awesomeman954）阵亡。EMIL 1951前压。"),
                "standalone must stay fail-closed when anchors conflict across sections");
        assertEquals("赛前：Maus（A158布丁）带队", response.preBattleSection(),
                "each anchored mention is locally corrected to its own roster tank");
        assertFalse(response.analysis().contains("Kranvagn前压"));
        assertFalse(response.analysis().contains("Maus前压"));
    }

    @Test
    void packagePropagation_sourceInRoster_crossSectionNotRewritten() throws IOException {
        when(aiAnalysisService.analyzeTeamGroups(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new TeamAnalyzeResult(
                        new AnalyzeResult("埃米尔1951（Awesomeman954）阵亡"),
                        "赛前：EMIL 1951负责正面推进"));
        // 本场同时有 Kranvagn 与 EMIL 1951：source canonical 本身在 roster → 跨段不得传播
        when(processingFacade.process(any(), any())).thenReturn(randomBattleResult(
                "team-arena", 2, List.of(
                        player("Awesomeman954", 1001L, 1, 4481),
                        player("EMILPlayer", 2001L, 2, 4737))));

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("Kranvagn（Awesomeman954）阵亡"),
                "anchored mention is locally corrected to Kranvagn");
        assertEquals("赛前：EMIL 1951负责正面推进", response.preBattleSection(),
                "standalone EMIL 1951 may be the real tank in roster, must not be rewritten");
    }

    @Test
    void packagePropagation_nullPreBattleSection_analysisStillCorrected() throws IOException {
        when(aiAnalysisService.analyzeTeamGroups(any(), eq(AllowedLanguage.ZH), any()))
                .thenReturn(new TeamAnalyzeResult(
                        new AnalyzeResult("埃米尔1951（Awesomeman954）阵亡"),
                        null));
        when(processingFacade.process(any(), any())).thenReturn(randomBattleResult(
                "team-arena", 2, List.of(
                        player("Awesomeman954", 1001L, 1, 4481),
                        player("A158布丁", 2001L, 2, 6929))));

        final AnalyzeResponse response = service.analyze(new MultipartFile[]{singleFile()});

        assertTrue(response.analysis().startsWith("Kranvagn（Awesomeman954）阵亡"),
                "analysis must still be corrected when preBattleSection is null");
        assertNull(response.preBattleSection(),
                "null preBattleSection must stay null (no NPE)");
    }

    private static PlayerResult player(final String nickname, final long accountId,
                                       final int team, final long tankId) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.nickname = nickname;
        p.team = team;
        p.tankId = tankId;
        p.tankName = "S16_Kranvagn";
        p.survived = true;
        return p;
    }

    private static ReplayProcessingResult randomBattleResult(
            final String arenaId, final int arenaBonusType, final List<PlayerResult> players) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "team_map";
        battle.arenaBonusType = arenaBonusType;
        battle.durationS = 300.0;
        battle.winnerTeam = 1;
        battle.recorder = players.getFirst().nickname;
        battle.players = players;
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                arenaId + ".wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("h", arenaId, "11.0", "team_map", players.getFirst().accountId, null),
                battle, null, null, capabilities, null, null);
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
