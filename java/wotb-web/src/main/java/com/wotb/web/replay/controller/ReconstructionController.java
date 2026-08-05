package com.wotb.web.replay.controller;

import com.wotb.core.model.Source;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.MixedAnalysisScopesException;
import com.wotb.core.processing.MixedRandomBattleRecordersException;
import com.wotb.core.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.processing.ReplayBatchProcessingResult;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import com.wotb.web.replay.metrics.ReplayUsageMetrics;
import org.springframework.beans.factory.annotation.Autowired;
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
 * AI 复盘与批量处理 REST API。
 * <p>
 * 需要 wotbtools-user 或 wotbtools-admin 角色（见 {@code SecurityConfig}）。
 * 回放重建不再单独暴露端点，由 {@code /analyze} 在内部完成。
 * </p>
 */
@RestController
@RequestMapping("/api/replay")
@CrossOrigin(origins = "*")
public class ReconstructionController {

    private final DefaultReplayProcessingFacade processingFacade;
    private final AiReplayReviewService reviewService;

    @Autowired(required = false)
    private ReplayUsageMetrics usageMetrics;

    public ReconstructionController(
            final DefaultReplayProcessingFacade processingFacade,
            final AiReplayReviewService reviewService) {
        this.processingFacade = processingFacade;
        this.reviewService = reviewService;
    }

    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public AnalyzeResponse analyze(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "lang", required = true) final String lang) throws IOException {
        final AllowedLanguage allowedLanguage = AllowedLanguage.fromCode(lang);
        if (allowedLanguage == null) {
            throw new IllegalArgumentException("UNKNOWN_LOCALE");
        }
        return reviewService.analyze(files, allowedLanguage);
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
        return timed(ReplayUsageMetrics.OP_RECONSTRUCT, files.length, () -> processingFacade.processBatch(sources, ReplayProcessingOptions.full()));
    }

    @PostMapping(value = "/process", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReplayBatchProcessingResult process(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "reconstruct", defaultValue = "false") final boolean doReconstruct) throws IOException {

        validateBatch(files);

        final ReplayProcessingOptions options = doReconstruct
                ? ReplayProcessingOptions.full()
                : ReplayProcessingOptions.summaryOnly();

        return timed(ReplayUsageMetrics.OP_PROCESS, files.length, () -> processingFacade.processBatch(toSources(files), options));
    }

    /** 执行并统计回放解析使用指标（成功与异常都记录；无 ReplayUsageMetrics 时原样执行）。 */
    private <T> T timed(final String operation, final int fileCount, final ThrowingSupplier<T> body) throws IOException {
        if (usageMetrics == null) {
            return invoke(body);
        }
        try {
            return usageMetrics.timed(operation, fileCount, body::get);
        } catch (final IOException e) {
            throw e;
        } catch (final RuntimeException e) {
            // 保留 runtime 异常身份，使 @ExceptionHandler(IllegalArgumentException.class) 等映射仍生效
            throw e;
        } catch (final Exception e) {
            throw new IOException(e);
        }
    }

    private static <T> T invoke(final ThrowingSupplier<T> body) throws IOException {
        try {
            return body.get();
        } catch (final IOException e) {
            throw e;
        } catch (final RuntimeException e) {
            throw e;
        } catch (final Exception e) {
            throw new IOException(e);
        }
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws Exception;
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
