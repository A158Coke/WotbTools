package com.wotb.web.replay.controller;

import com.wotb.core.model.Source;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.BattleCategory;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayAnalysisMode;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayBatchProcessingResult;
import com.wotb.core.processing.ReplayFileAnalysisStatus;
import com.wotb.core.processing.ReplayFileRelation;
import com.wotb.core.processing.AnalysisUnitResult;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingError;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.core.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
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

        // 1. 逐文件处理（非先全部读取再处理）：降低内存峰值
        final List<ReplayProcessingResult> allResults = new ArrayList<>();
        for (final MultipartFile f : files) {
            final String name = f.getOriginalFilename() != null ? f.getOriginalFilename() : "replay.wotbreplay";
            final byte[] bytes = f.getBytes();
            allResults.add(processingFacade.process(
                    new Source(name, bytes), ReplayProcessingOptions.full()));
            // bytes 释放后 GC 回收
        }

        // 2. BatchAnalyzer 视角分组 + 模式判定
        final BatchAnalyzer analyzer = new BatchAnalyzer();
        final BatchAnalyzer.AnalysisPlan plan = analyzer.analyze(allResults);

        // 3. 构建文件状态
        final List<ReplayFileAnalysisStatus> fileStatuses = new ArrayList<>();
        for (final var gp : plan.groups()) {
            final var rep = gp.representative();
            final var cap = rep.capabilities();
            fileStatuses.add(ReplayFileAnalysisStatus.primary(
                    rep.fileName(), rep.status(),
                    BattleCategory.RANDOM, plan.dominantScope(),
                    rep.battle() != null ? rep.battle().arenaId : null,
                    0, cap));
            for (final var dup : gp.duplicates()) {
                fileStatuses.add(ReplayFileAnalysisStatus.duplicate(
                        dup.fileName(),
                        ReplayFileRelation.SAME_TEAM_DUPLICATE_PERSPECTIVE,
                        rep.fileName()));
            }
        }
        // 失败文件
        for (final ReplayProcessingResult r : allResults) {
            if (r.status() == ReplayProcessingStatus.FAILED) {
                fileStatuses.add(ReplayFileAnalysisStatus.failed(
                        r.fileName(), r.error() != null ? r.error()
                                : ReplayProcessingError.of("FAILED", "Processing failed")));
            }
        }

        // 4. 统计
        final int total = files.length;
        final int analyzableCount = (int) allResults.stream()
                .filter(r -> r.capabilities() != null && r.capabilities().aiAnalyzable())
                .count();
        final int successCount = (int) allResults.stream()
                .filter(r -> r.status() == ReplayProcessingStatus.SUCCESS).count();
        final int partialCount = (int) allResults.stream()
                .filter(r -> r.status() == ReplayProcessingStatus.PARTIAL_SUCCESS).count();
        final int failedCount = total - successCount - partialCount;
        final int dupCount = (int) allResults.stream()
                .filter(r -> r.status() == ReplayProcessingStatus.FAILED
                        && r.error() != null && "DUPLICATE_FILE".equals(r.error().code()))
                .count();

        if (analyzableCount == 0) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }

        // 5. 按 scope 调用 AI
        final int effectiveUnits = plan.effectiveUnitCount();
        if (plan.dominantScope() == ReplayAnalysisScope.PLAYER_FOCUSED) {
            final var reps = plan.groups().stream()
                    .map(ReplayPerspectiveGroup::representative)
                    .toList();
            if (effectiveUnits == 1) {
                // 单场随机战斗 — 使用 context 感知入口（含特征数据）
                final var rep = reps.getFirst();
                final var aiResult = callPlayerContext(rep);
                return new AnalyzeResponse(
                        ReplayAnalysisMode.SINGLE_PLAYER_BATTLE,
                        total, analyzableCount, effectiveUnits, 1, effectiveUnits,
                        aiResult.analysis(), failedCount, dupCount, 0,
                        fileStatuses, buildAnalysisUnits(plan.groups()), aiResult.keyEvents());
            }
            // 多场随机战斗
            final var battles = reps.stream()
                    .map(ReplayProcessingResult::battle)
                    .toList();
            final var aiResult = aiService.analyzeMulti(battles);
            return new AnalyzeResponse(
                    ReplayAnalysisMode.MULTI_PLAYER_BATTLE,
                    total, analyzableCount, effectiveUnits, effectiveUnits, effectiveUnits,
                    aiResult.analysis(), failedCount, dupCount, 0,
                    fileStatuses, buildAnalysisUnits(plan.groups()), aiResult.keyEvents());
        }

        // TEAM_PERSPECTIVE 或无 scope - 团队 AI 尚未实现
        throw new UnsupportedReplayAnalysisModeException(
                "TEAM_ANALYSIS_NOT_IMPLEMENTED");
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

    /** 请求/数据错误（文件校验失败、NO_BATTLE_DATA 等）→ 400。 */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<String> handleBadRequest(final IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /** AI 未配置密钥 → 503 AI_NOT_CONFIGURED。 */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<String> handleNotConfigured(final IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /** 上游 AI 调用失败 → 502。 */
    @ExceptionHandler(AiUpstreamException.class)
    public ResponseEntity<String> handleUpstream(final AiUpstreamException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
    }

    /** 不支持的 AI 分析模式（团队视角等）→ 422。 */
    @ExceptionHandler(UnsupportedReplayAnalysisModeException.class)
    public ResponseEntity<String> handleUnsupportedMode(final UnsupportedReplayAnalysisModeException e) {
        return ResponseEntity.unprocessableEntity()
                .contentType(MediaType.TEXT_PLAIN)
                .body(e.getMessage());
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

    /**
     * 将 MultipartFile 数组转换为 Source 列表（复用，消除重复代码）。
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

    private AiReplayAnalysisService.AnalyzeResult callPlayerContext(final ReplayProcessingResult rep) {
        if (rep.battle() == null) return new AiReplayAnalysisService.AnalyzeResult("", "", List.of());
        if (rep.reconstruction() == null) {
            return aiService.analyze(rep.battle(), null);
        }

        final SinglePlayerBattleAnalysisContext context;
        try {
            final var extractor = new DefaultPlayerBattleFeatureExtractor();
            final var recorder = findRecorder(rep);
            final PlayerBattleFeatureSet featureSet = extractor.extract(rep.reconstruction(), recorder);
            context = new SinglePlayerBattleAnalysisContext(
                    null, rep.battle(), featureSet, recorder,
                    rep.reconstruction().coverage(), featureSet.limitations());
        } catch (Exception extractionException) {
            System.getLogger("ReconstructionController")
                    .log(System.Logger.Level.WARNING,
                            "Feature extraction failed, falling back: {0}",
                            extractionException.getMessage());
            return aiService.analyze(rep.battle(), rep.reconstruction());
        }

        return aiService.analyzePlayerContext(context);
    }

    private static RecorderEntityMapping findRecorder(final ReplayProcessingResult rep) {
        if (rep.reconstruction() != null) {
            // 从 ParticipantMappingEvent 建立 entityId → accountId 映射
            final java.util.Map<Long, Integer> entityByAccount = new java.util.HashMap<>();
            for (final var e : rep.reconstruction().events()) {
                if (e instanceof com.wotb.core.replay.event.ParticipantMappingEvent pm) {
                    entityByAccount.put(pm.accountId(), pm.entityId());
                }
            }
            for (final var p : rep.reconstruction().participants()) {
                if (p.recorder()) {
                    final Integer eid = entityByAccount.get(p.accountId());
                    return new RecorderEntityMapping(p.accountId(), (int) p.tankId(),
                            eid, p.nickname(), p.team(), (int) p.tankId(),
                            eid != null ? DecodeConfidence.EXACT : DecodeConfidence.INFERRED);
                }
            }
        }
        if (rep.battle() != null && rep.battle().recorder != null)
            return new RecorderEntityMapping(null, null, null,
                    rep.battle().recorder, 0, 0, DecodeConfidence.INFERRED);
        return RecorderEntityMapping.unresolved();
    }

    private static List<AnalysisUnitResult> buildAnalysisUnits(final List<ReplayPerspectiveGroup> groups) {
        return groups.stream()
                .<AnalysisUnitResult>map(g -> new AnalysisUnitResult(
                        "unit-" + g.key().battleIdentity().arenaUniqueId(),
                        g.key().battleIdentity(),
                        null,
                        g.key().perspectiveTeam(),
                        g.representative().fileName(),
                        g.duplicates().stream().map(ReplayProcessingResult::fileName).toList(),
                        null, null
                ))
                .toList();
    }
}
