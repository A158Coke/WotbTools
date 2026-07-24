package com.wotb.web.replay.controller;

import com.wotb.core.model.Source;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.MixedAnalysisScopesException;
import com.wotb.core.processing.MixedRandomBattleRecordersException;
import com.wotb.core.processing.ReplayAnalysisMode;
import com.wotb.core.processing.ReplayBatchProcessingResult;
import com.wotb.core.processing.ReplayFileAnalysisStatus;
import com.wotb.core.processing.ReplayFileRelation;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingError;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.dto.ReconstructSummary;
import com.wotb.web.replay.dto.StateAtResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 回放重建 REST API（开发和验证用）。
 * <p>
 * 需要 wotbtools-admin 角色。
 * </p>
 */
@RestController
@RequestMapping("/api/replay")
@CrossOrigin(origins = "*")
public class ReconstructionController {

    private final DefaultReplayProcessingFacade processingFacade;
    private final ReplayReconstructionService reconstructionService;
    private final AiReplayAnalysisService aiService;

    public ReconstructionController(
            final DefaultReplayProcessingFacade processingFacade,
            final ReplayReconstructionService reconstructionService,
            final AiReplayAnalysisService aiService) {
        this.processingFacade = processingFacade;
        this.reconstructionService = reconstructionService;
        this.aiService = aiService;
    }

    /**
     * 单文件完整重建并返回摘要。
     * POST /api/replay/reconstruct
     */
    @PostMapping(value = "/reconstruct", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReconstructSummary reconstruct(
            @RequestParam("file") final MultipartFile file) throws IOException {

        validateFile(file);

        final byte[] replayBytes = file.getBytes();
        final ReplayReconstruction result = reconstructionService.reconstruct(replayBytes);

        return new ReconstructSummary(
                result.replayDurationSec(),
                result.battleStartRawClockSec(),
                result.diagnostics().packetCount(),
                result.coverage().decodedPackets(),
                result.participants().size(),
                result.finalState().entityCount(),
                result.events().size(),
                result.checkpoints().size(),
                result.finalState(),
                result.coverage(),
                result.diagnostics()
        );
    }

    /**
     * 任意时间点状态查询。
     * POST /api/replay/state-at
     */
    @PostMapping(value = "/state-at", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public StateAtResponse stateAt(
            @RequestParam("file") final MultipartFile file,
            @RequestParam("time") final float timeSec) throws IOException {

        validateFile(file);

        final byte[] replayBytes = file.getBytes();
        final BattleStateSnapshot snapshot = reconstructionService.stateAt(replayBytes, timeSec);

        return StateAtResponse.from(snapshot);
    }

    /**
     * AI 战术复盘（支持一个或多个文件）。
     * <p>
     * 使用统一批量处理流程：
     * <ol>
     *   <li>逐文件 process()</li>
     *   <li>BatchAnalyzer 视角分组 + 代表选择 + mode 判定</li>
     *   <li>scope 感知的 AI 调用</li>
     * </ol>
     * </p>
     * POST /api/replay/analyze
     */
    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AnalyzeResponse analyze(
            @RequestParam("files") final MultipartFile[] files) throws IOException {

        validateBatch(files);
        final List<ReplayProcessingResult> allResults = processFiles(files);
        final BatchAnalyzer.AnalysisPlan plan = new BatchAnalyzer().analyze(allResults);

        if (plan.dominantScope() == null) throw new UnsupportedReplayAnalysisModeException("UNSUPPORTED_BATTLE_CATEGORY");
        final int total = files.length;

        // 只取真正可分析的单元
        final var analyzableGroups = plan.groups().stream()
                .filter(g -> g.representative().capabilities() != null
                        && g.representative().capabilities().aiAnalyzable())
                .toList();
        if (analyzableGroups.isEmpty()) throw new IllegalArgumentException("NO_BATTLE_DATA");

        final var fileStatuses = buildFileStatuses(allResults, plan);
        final int failedCount = countFailed(fileStatuses);
        final int analyzedUnitCount = analyzableGroups.size();
        final var units = AiReplayAnalysisService.buildAnalysisUnits(analyzableGroups);

        // 按 plan.mode() 选择分析路径
        return switch (plan.mode()) {
            case SINGLE_PLAYER_BATTLE -> {
                final var aiResult = aiService.analyzePlayerOrFallback(
                        analyzableGroups.getFirst().representative());
                yield new AnalyzeResponse(ReplayAnalysisMode.SINGLE_PLAYER_BATTLE,
                        total, (int) allResults.stream().filter(r -> r.capabilities() != null && r.capabilities().aiAnalyzable()).count(),
                        plan.effectiveUnitCount(), 1, 1,
                        aiResult.analysis(), failedCount,
                        plan.exactDuplicateCount(), plan.sameTeamDuplicatePerspectiveCount(),
                        fileStatuses, units, aiResult.keyEvents());
            }
            case MULTI_PLAYER_BATTLE -> {
                final var battles = analyzableGroups.stream()
                        .map(ReplayPerspectiveGroup::representative)
                        .map(ReplayProcessingResult::battle)
                        .toList();
                final var aiResult = aiService.analyzeMulti(battles);
                yield new AnalyzeResponse(ReplayAnalysisMode.MULTI_PLAYER_BATTLE,
                        total, (int) allResults.stream().filter(r -> r.capabilities() != null && r.capabilities().aiAnalyzable()).count(),
                        plan.effectiveUnitCount(), analyzedUnitCount, analyzedUnitCount,
                        aiResult.analysis(), failedCount,
                        plan.exactDuplicateCount(), plan.sameTeamDuplicatePerspectiveCount(),
                        fileStatuses, units, aiResult.keyEvents());
            }
            case SINGLE_TEAM_BATTLE, MULTI_TEAM_BATTLE ->
                    throw new UnsupportedReplayAnalysisModeException("TEAM_ANALYSIS_NOT_IMPLEMENTED");
            case NONE -> throw new IllegalArgumentException("NO_BATTLE_DATA");
        };
    }

    /**
     * 批量重建（公开给 admin 使用的新 pipeline）。
     * POST /api/replay/reconstruct-batch
     */
    @PostMapping(value = "/reconstruct-batch", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReplayBatchProcessingResult reconstructBatch(
            @RequestParam("files") final MultipartFile[] files) throws IOException {

        validateBatch(files);
        final List<Source> sources = toSources(files);
        return processingFacade.processBatch(sources, ReplayProcessingOptions.full());
    }

    @PostMapping(value = "/process", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReplayBatchProcessingResult process(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "reconstruct", defaultValue = "false") final boolean doReconstruct) throws IOException {

        validateBatch(files);

        final ReplayProcessingOptions options = doReconstruct
                ? ReplayProcessingOptions.full()
                : ReplayProcessingOptions.summaryOnly();

        return processingFacade.processBatch(toSources(files), options);
    }

    // ---- 异常映射（仅本控制器；返回稳定错误码文本，供前端本地化） ----

    /**
     * 请求/数据错误（文件校验失败、NO_BATTLE_DATA 等）→ 400。
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<String> handleBadRequest(final IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /**
     * AI 未配置密钥 → 503 AI_NOT_CONFIGURED。
     */
    @ExceptionHandler(AiNotConfiguredException.class)
    public ResponseEntity<String> handleAiNotConfigured(final AiNotConfiguredException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.TEXT_PLAIN)
                .body("AI_NOT_CONFIGURED");
    }

    /**
     * 上游 AI 调用失败 → 502。
     */
    @ExceptionHandler(AiUpstreamException.class)
    public ResponseEntity<String> handleUpstream(final AiUpstreamException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /**
     * 不支持的 AI 分析模式（团队视角等）→ 422。
     */
    @ExceptionHandler(UnsupportedReplayAnalysisModeException.class)
    public ResponseEntity<String> handleUnsupportedMode(final UnsupportedReplayAnalysisModeException e) {
        return ResponseEntity.unprocessableContent()
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /**
     * 随机战斗与训练房/联赛混合 → 400。
     */
    @ExceptionHandler(MixedAnalysisScopesException.class)
    public ResponseEntity<String> handleMixedScopes(final MixedAnalysisScopesException e) {
        return ResponseEntity.badRequest()
                .contentType(MediaType.TEXT_PLAIN)
                .body("MIXED_ANALYSIS_SCOPES");
    }

    /**
     * 不同录像者混入（多场随机战斗）→ 400。
     */
    @ExceptionHandler(MixedRandomBattleRecordersException.class)
    public ResponseEntity<String> handleMixedRecorders(final MixedRandomBattleRecordersException e) {
        return ResponseEntity.badRequest()
                .contentType(MediaType.TEXT_PLAIN)
                .body("MIXED_RANDOM_BATTLE_RECORDERS");
    }

    // ---- 验证 ----

    private static void validateFile(final MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("NO_REPLAY_FILE");
        }
        final String name = file.getOriginalFilename();
        if (name != null && !name.toLowerCase().endsWith(".wotbreplay")) {
            throw new IllegalArgumentException("INVALID_REPLAY_FILE_TYPE");
        }
        if (file.getSize() > 20L * 1024 * 1024) {
            throw new IllegalArgumentException("FILE_TOO_LARGE");
        }
    }

    private static void validateBatch(final MultipartFile[] files) {
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException("NO_REPLAY_FILES");
        }
        if (files.length > 10) {
            throw new IllegalArgumentException("TOO_MANY_REPLAY_FILES");
        }
        long totalBytes = 0;
        for (final MultipartFile file : files) {
            validateFile(file);
            totalBytes += file.getSize();
        }
        if (totalBytes > 200L * 1024 * 1024) {
            throw new IllegalArgumentException("TOTAL_REQUEST_TOO_LARGE");
        }
    }

    // ---- 辅助 ----

    private List<ReplayProcessingResult> processFiles(final MultipartFile[] files) throws IOException {
        final List<ReplayProcessingResult> results = new ArrayList<>();
        for (final MultipartFile f : files) {
            final String name = f.getOriginalFilename() != null ? f.getOriginalFilename() : "replay.wotbreplay";
            results.add(processingFacade.process(
                    new Source(name, f.getBytes()), ReplayProcessingOptions.full()));
        }
        return results;
    }

    private static List<ReplayFileAnalysisStatus> buildFileStatuses(
            final List<ReplayProcessingResult> allResults,
            final BatchAnalyzer.AnalysisPlan plan) {
        final List<ReplayFileAnalysisStatus> statuses = new ArrayList<>();
        final java.util.Set<String> indexed = new java.util.HashSet<>();
        for (final var gp : plan.groups()) {
            final var rep = gp.representative();
            statuses.add(ReplayFileAnalysisStatus.primary(
                    rep.fileName(), rep.status(), BattleCategory.RANDOM, plan.dominantScope(),
                    rep.battle() != null ? rep.battle().arenaId : null,
                    gp.key().perspectiveTeam(), rep.capabilities()));
            indexed.add(rep.fileName());
            for (final var dup : gp.duplicates()) {
                statuses.add(ReplayFileAnalysisStatus.duplicate(
                        dup.fileName(), dup.status(),
                        ReplayFileRelation.SAME_TEAM_DUPLICATE_PERSPECTIVE,
                        rep.fileName()));
                indexed.add(dup.fileName());
            }
        }
        for (final var dup : plan.exactDuplicates()) {
            statuses.add(ReplayFileAnalysisStatus.duplicate(
                    dup.duplicate().fileName(), dup.duplicate().status(),
                    ReplayFileRelation.EXACT_DUPLICATE,
                    dup.original().fileName()));
            indexed.add(dup.duplicate().fileName());
        }
        for (final ReplayProcessingResult r : allResults) {
            if (r.status() == ReplayProcessingStatus.FAILED && !indexed.contains(r.fileName())) {
                statuses.add(ReplayFileAnalysisStatus.failed(
                        r.fileName(), r.error() != null ? r.error()
                                : ReplayProcessingError.of("FAILED", "Processing failed")));
            }
        }
        return statuses;
    }

    private static int countFailed(final List<ReplayFileAnalysisStatus> statuses) {
        return (int) statuses.stream()
                .filter(f -> f.status() == ReplayProcessingStatus.FAILED
                        && f.relation() == ReplayFileRelation.INDEPENDENT_BATTLE
                        && f.error() != null)
                .count();
    }

    /**
     * 将 MultipartFile 数组转换为 Source 列表。
     */
    private static List<Source> toSources(final MultipartFile[] files) throws IOException {
        final List<Source> sources = new ArrayList<>();
        for (final MultipartFile f : files) {
            sources.add(new Source(
                    f.getOriginalFilename() != null ? f.getOriginalFilename() : "replay.wotbreplay",
                    f.getBytes()));
        }
        return sources;
    }
}
