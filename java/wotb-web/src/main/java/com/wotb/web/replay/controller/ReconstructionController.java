package com.wotb.web.replay.controller;

import com.wotb.core.model.Source;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.BattleCategoryUtils;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.MixedAnalysisScopesException;
import com.wotb.core.processing.MixedRandomBattleRecordersException;
import com.wotb.core.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.processing.ReplayAnalysisMode;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayBatchProcessingResult;
import com.wotb.core.processing.ReplayFileAnalysisStatus;
import com.wotb.core.processing.ReplayFileRelation;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingError;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiReplayBatchPolicy;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.dto.ReconstructSummary;
import com.wotb.web.replay.dto.StateAtResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
    private final AiReplayReviewService reviewService;

    public ReconstructionController(
            final DefaultReplayProcessingFacade processingFacade,
            final ReplayReconstructionService reconstructionService,
            final AiReplayAnalysisService aiService,
            final AiReplayReviewService reviewService) {
        this.processingFacade = processingFacade;
        this.reconstructionService = reconstructionService;
        this.aiService = aiService;
        this.reviewService = reviewService;
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

        final var ctx = reviewService.process(files);
        final var allResults = ctx.allResults();
        final var plan = ctx.plan();
        final var total = ctx.totalFiles();
        // Rebuild upload results for file status builder
        final List<ReplayUploadResult> uploadResults = new ArrayList<>();
        for (int index = 0; index < allResults.size(); index++) {
            uploadResults.add(new ReplayUploadResult(
                    index, allResults.get(index).fileName(), allResults.get(index)));
        }

        // 先检查是否有成功解析的 Battle
        final boolean hasParsedBattle = allResults.stream().anyMatch(r -> r.battle() != null);
        if (!hasParsedBattle) throw new IllegalArgumentException("NO_BATTLE_DATA");

        // 再检查 scope
        if (plan.dominantScope() == null) throw new UnsupportedReplayAnalysisModeException("UNSUPPORTED_BATTLE_CATEGORY");

        // scope 感知地筛选可分析单元；Team 允许权威结算 fallback。
        final var analyzableGroups = plan.groups().stream()
                .filter(g -> g.representative().capabilities() != null
                        && BatchAnalyzer.isAiAnalyzable(g.representative(), plan.dominantScope()))
                .toList();
        if (analyzableGroups.isEmpty()) {
            if (plan.dominantScope() == ReplayAnalysisScope.TEAM_PERSPECTIVE) {
                final boolean teamResolved = plan.groups().stream()
                        .map(ReplayPerspectiveGroup::representative)
                        .map(ReplayProcessingResult::capabilities)
                        .anyMatch(capabilities -> capabilities != null
                                && capabilities.perspectiveTeamResolved());
                if (teamResolved) {
                    throw new IllegalArgumentException("TEAM_FEATURES_UNAVAILABLE");
                }
                throw new PerspectiveTeamNotResolvedException(
                        unresolvedTeamCode(plan.groups()));
            }
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }

        final var fileStatuses = buildFileStatuses(uploadResults, plan);
        final int failedCount = countFailed(fileStatuses);
        final int analyzedUnitCount = analyzableGroups.size();
        final int validCount = (int) allResults.stream()
                .filter(r -> r.capabilities() != null
                        && BatchAnalyzer.isAiAnalyzable(r, plan.dominantScope()))
                .count();

        // 按 plan.mode() 选择分析路径
        return switch (plan.mode()) {
            case SINGLE_PLAYER_BATTLE -> {
                final var aiResult = aiService.analyzePlayerOrFallback(
                        analyzableGroups.getFirst().representative());
                final var units = AiReplayAnalysisService.buildAnalysisUnits(
                        analyzableGroups, plan.dominantScope());
                yield new AnalyzeResponse(ReplayAnalysisMode.SINGLE_PLAYER_BATTLE,
                        total, validCount,
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
                final var units = AiReplayAnalysisService.buildAnalysisUnits(
                        analyzableGroups, plan.dominantScope());
                yield new AnalyzeResponse(ReplayAnalysisMode.MULTI_PLAYER_BATTLE,
                        total, validCount,
                        plan.effectiveUnitCount(), analyzedUnitCount, analyzedUnitCount,
                        aiResult.analysis(), failedCount,
                        plan.exactDuplicateCount(), plan.sameTeamDuplicatePerspectiveCount(),
                        fileStatuses, units, aiResult.keyEvents());
            }
            case SINGLE_TEAM_BATTLE, MULTI_TEAM_BATTLE -> {
                final var teamResult = aiService.analyzeTeamGroups(analyzableGroups);
                final var aiResult = teamResult.analysis();
                yield new AnalyzeResponse(plan.mode(),
                        total, validCount,
                        plan.effectiveUnitCount(), teamResult.analyzedUnitCount(), teamResult.analyzedUnitCount(),
                        aiResult.analysis(), failedCount,
                        plan.exactDuplicateCount(), plan.sameTeamDuplicatePerspectiveCount(),
                        fileStatuses, teamResult.units(), aiResult.keyEvents());
            }
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
    @ExceptionHandler(AiPromptBudgetExceededException.class)
    public ResponseEntity<Map<String, Object>> handlePromptBudgetExceeded(final AiPromptBudgetExceededException e) {
        final Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", "AI_PROMPT_MANDATORY_SECTION_TOO_LARGE");
        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<String> handleBadRequest(final IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    @ExceptionHandler(ReplayFileCountExceededException.class)
    public ResponseEntity<Map<String, Object>> handleFileCountExceeded(
            final ReplayFileCountExceededException e
    ) {
        final Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", "REPLAY_FILE_COUNT_EXCEEDED");
        body.put("maxFiles", e.getMaxFiles());
        body.put("actualFiles", e.getActualFiles());
        return ResponseEntity.badRequest().body(body);
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
                .body(e.code());
    }

    /**
     * 不支持的 AI 分析模式 → 422。
     */
    @ExceptionHandler(UnsupportedReplayAnalysisModeException.class)
    public ResponseEntity<String> handleUnsupportedMode(final UnsupportedReplayAnalysisModeException e) {
        return ResponseEntity.unprocessableContent()
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /**
     * 无法可靠确定训练房/联赛的 perspectiveTeam → 422。
     */
    @ExceptionHandler(PerspectiveTeamNotResolvedException.class)
    public ResponseEntity<String> handlePerspectiveTeam(
            final PerspectiveTeamNotResolvedException e
    ) {
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

    /** 上传处理结果，含请求项唯一 ID。 */
    private record ReplayUploadResult(int uploadIndex, String fileName, ReplayProcessingResult processingResult) {}

    private List<ReplayUploadResult> processFilesWithIndex(final MultipartFile[] files) throws IOException {
        final List<ReplayUploadResult> results = new ArrayList<>();
        for (int i = 0; i < files.length; i++) {
            final String name = files[i].getOriginalFilename() != null
                    ? files[i].getOriginalFilename() : "replay.wotbreplay";
            results.add(new ReplayUploadResult(i, name,
                    processingFacade.process(new Source(name, files[i].getBytes()), ReplayProcessingOptions.full())));
        }
        return results;
    }

    private static List<ReplayFileAnalysisStatus> buildFileStatuses(
            final List<ReplayUploadResult> uploadResults,
            final BatchAnalyzer.AnalysisPlan plan) {
        // 使用 IdentityHashMap 确保按对象身份而非结构 equality 映射
        final java.util.IdentityHashMap<ReplayProcessingResult, Integer> resultToIndex = new java.util.IdentityHashMap<>();
        for (final var ur : uploadResults) {
            resultToIndex.put(ur.processingResult(), ur.uploadIndex());
        }

        final java.util.IdentityHashMap<ReplayProcessingResult, Boolean> indexed = new java.util.IdentityHashMap<>();
        final List<ReplayFileAnalysisStatus> statuses = new ArrayList<>();

        for (final var gp : plan.groups()) {
            final var rep = gp.representative();
            final int repIdx = resultToIndex.getOrDefault(rep, -1);
            final BattleCategory category = rep.battle() != null
                    ? BattleCategoryUtils.fromArenaBonusType(rep.battle().arenaBonusType)
                    : BattleCategory.UNKNOWN;
            statuses.add(ReplayFileAnalysisStatus.primary(
                    rep.fileName(), rep.status(), category, plan.dominantScope(),
                    rep.battle() != null ? rep.battle().arenaId : null,
                    gp.key().perspectiveTeam(),
                    BatchAnalyzer.isAiAnalyzable(rep, plan.dominantScope()),
                    repIdx, rep.capabilities()));
            indexed.put(rep, Boolean.TRUE);
            for (final var dup : gp.duplicates()) {
                final int dupIdx = resultToIndex.getOrDefault(dup, -1);
                statuses.add(ReplayFileAnalysisStatus.duplicate(
                        dup.fileName(), dup.status(),
                        ReplayFileRelation.SAME_TEAM_DUPLICATE_PERSPECTIVE,
                        rep.fileName(), dupIdx, repIdx));
                indexed.put(dup, Boolean.TRUE);
            }
        }
        for (final var dup : plan.exactDuplicates()) {
            final int dupIdx = resultToIndex.getOrDefault(dup.duplicate(), -1);
            final int origIdx = resultToIndex.getOrDefault(dup.original(), -1);
            statuses.add(ReplayFileAnalysisStatus.duplicate(
                    dup.duplicate().fileName(), dup.duplicate().status(),
                    ReplayFileRelation.EXACT_DUPLICATE,
                    dup.original().fileName(), dupIdx, origIdx));
            indexed.put(dup.duplicate(), Boolean.TRUE);
        }
        for (final var ur : uploadResults) {
            final var r = ur.processingResult();
            if (r.status() == ReplayProcessingStatus.FAILED && !indexed.containsKey(r)) {
                statuses.add(ReplayFileAnalysisStatus.failed(
                        r.fileName(), r.error() != null ? r.error()
                                : ReplayProcessingError.of("FAILED", "Processing failed"), ur.uploadIndex()));
            }
        }

        // 显式校验每个 uploadIndex
        final int uploadCount = uploadResults.size();
        if (statuses.size() != uploadCount) {
            throw new IllegalStateException(
                    "FILE_STATUS_COUNT_MISMATCH: " + statuses.size() + " != " + uploadCount);
        }
        final var uploadIndices = statuses.stream()
                .map(ReplayFileAnalysisStatus::uploadIndex)
                .collect(java.util.stream.Collectors.toSet());
        if (uploadIndices.size() != uploadCount) {
            throw new IllegalStateException("DUPLICATE_UPLOAD_INDEX");
        }
        for (int i = 0; i < uploadCount; i++) {
            if (!uploadIndices.contains(i)) {
                throw new IllegalStateException("MISSING_UPLOAD_INDEX_" + i);
            }
        }
        // 验证 duplicate 关联
        for (final var s : statuses) {
            if (s.uploadIndex() < 0 || s.uploadIndex() >= uploadCount) {
                throw new IllegalStateException("INVALID_UPLOAD_INDEX_" + s.uploadIndex());
            }
            final boolean isDup = s.relation() == ReplayFileRelation.EXACT_DUPLICATE
                    || s.relation() == ReplayFileRelation.SAME_TEAM_DUPLICATE_PERSPECTIVE;
            if (isDup) {
                final Integer origIdx = s.duplicateOfUploadIndex();
                if (origIdx == null || origIdx < 0 || origIdx >= uploadCount) {
                    throw new IllegalStateException("INVALID_DUPLICATE_OF_UPLOAD_INDEX");
                }
                if (origIdx == s.uploadIndex()) {
                    throw new IllegalStateException("DUPLICATE_POINTS_TO_SELF");
                }
            } else if (s.duplicateOfUploadIndex() != null) {
                throw new IllegalStateException("UNEXPECTED_DUPLICATE_OF_UPLOAD_INDEX");
            }
        }
        statuses.sort(java.util.Comparator.comparingInt(ReplayFileAnalysisStatus::uploadIndex));
        return statuses;
    }

    private static int countFailed(final List<ReplayFileAnalysisStatus> statuses) {
        return (int) statuses.stream()
                .filter(f -> f.status() == ReplayProcessingStatus.FAILED
                        && f.relation() == ReplayFileRelation.INDEPENDENT_BATTLE
                        && f.error() != null)
                .count();
    }

    private static String unresolvedTeamCode(
            final List<ReplayPerspectiveGroup> groups
    ) {
        final boolean conflict = groups.stream()
                .map(ReplayPerspectiveGroup::representative)
                .map(result -> TeamPerspectiveResolver.resolve(
                        result.battle(), result.reconstruction()))
                .anyMatch(resolution -> resolution.limitations().stream()
                        .anyMatch(code -> "PERSPECTIVE_TEAM_CONFLICT".equals(code)
                                || "RECORDER_IDENTITY_CONFLICT".equals(code)));
        return conflict
                ? "PERSPECTIVE_TEAM_CONFLICT"
                : "PERSPECTIVE_TEAM_UNRESOLVED";
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
