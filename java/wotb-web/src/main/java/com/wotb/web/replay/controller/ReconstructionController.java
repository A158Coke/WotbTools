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
import com.wotb.web.replay.ai.AiReplayBatchPolicy;
import com.wotb.web.replay.ai.AiReviewStreamListener;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiCancellationToken;
import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.config.ApiPaths;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.AiReviewBusyException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import com.wotb.web.replay.metrics.ReplayUsageMetrics;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;

/**
 * AI 复盘与批量处理 REST API。
 * <p>
 * 需要 wotbtools-user 或 wotbtools-admin 角色（见 {@code SecurityConfig}）。
 * 回放重建不再单独暴露端点，由 {@code /analyze} 在内部完成。
 * </p>
 */
@RestController
@CrossOrigin(origins = "*")
public class ReconstructionController {

    private final DefaultReplayProcessingFacade processingFacade;
    private final AiReplayReviewService reviewService;
    private final AiCancellationRegistry cancellationRegistry;
    private final AiReviewWorkerExecutor workerExecutor;

    /**
     * SSE 连接超时：对齐 nginx analyze 420s read timeout，避免服务端在代理之前
     * 提前关闭长流。
     */
    static final long SSE_TIMEOUT_MS = 420_000L;

    @Autowired(required = false)
    private ReplayUsageMetrics usageMetrics;

    public ReconstructionController(
            final DefaultReplayProcessingFacade processingFacade,
            final AiReplayReviewService reviewService,
            final AiCancellationRegistry cancellationRegistry,
            final AiReviewWorkerExecutor workerExecutor) {
        this.processingFacade = processingFacade;
        this.reviewService = reviewService;
        this.cancellationRegistry = cancellationRegistry;
        this.workerExecutor = workerExecutor;
    }

    /**
     * AI 复盘（SSE 流式）：阶段事件 + 主复盘 token 逐段到达，{@code done} 事件
     * 携带最终 {@code analysis} / {@code preBattleSection}（阶段 3 双字段契约）。
     * <p>异步模型：request 线程只做白名单/文件参数校验，然后注册 cancellation、
     * 创建 {@link SseEmitter}、注册生命周期回调并把完整 AI 复盘提交到
     * {@link AiReviewWorkerExecutor}，立即返回 emitter——servlet request 线程
     * 不被整个 AI Review 生命周期占住。真正的分析（含回放解析与上游流式调用）
     * 在 worker 线程执行，{@link com.wotb.web.replay.ai.gateway.AiRequestContext}
     * 在 worker 线程内 set/clear，cancellation 在 worker 真正结束后才 unregister，
     * 保证 cancel 端点在整个流式期间都能找到并取消进行中的请求。</p>
     * <p>异常传达规则（异步化后统一走 SSE 事件）：任何在 worker 内发生的失败
     * 都以 {@code error} 事件携带稳定错误码传达（无论是否已发送过事件），前端
     * 在收到事件前无法感知失败；客户端断开时立即调用 cancel 语义（取消上游调用），
     * 不向已断开的连接写入。</p>
     */
    @PostMapping(value = ApiPaths.REPLAY_ANALYZE, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public SseEmitter analyze(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "lang", required = true) final String lang,
            @RequestParam(name = "correlationId", required = false) final String correlationId) {
        final AllowedLanguage allowedLanguage = AllowedLanguage.fromCode(lang);
        if (allowedLanguage == null) {
            throw new IllegalArgumentException("UNKNOWN_LOCALE");
        }
        // HTTP request-envelope validation（request 线程同步执行）：文件参数校验
        // 在提交 worker 前完成，非法请求直接 HTTP 400（经 @ExceptionHandler），
        // 不进入 SSE 流。worker 内 analyzeInternal 保留相同校验作为防御。
        validateAnalyzeRequest(files);
        // Client-provided id (frontend cancel button / navigation) or a fresh
        // one; both are safe random opaque ids, never logged with the request.
        final String requestId = correlationId != null && !correlationId.isBlank()
                ? correlationId : UUID.randomUUID().toString();
        final AiCancellationToken cancellation = cancellationRegistry.register(requestId);
        final SseEmitter emitter = newAnalyzeEmitter();
        final ReplaySseWriter writer = new ReplaySseWriter(emitter);
        // 生命周期回调：timeout / error / 客户端断开都翻转 cancellation token
        // （经 registry 走 cancel 端点语义），与显式 cancel 端点幂等（token 是
        // CAS 一次性翻转，重复 cancel 无副作用）。
        emitter.onTimeout(() -> cancellationRegistry.cancel(requestId));
        emitter.onError(error -> cancellationRegistry.cancel(requestId));
        try {
            workerExecutor.execute(() -> runAnalysis(requestId, cancellation, emitter, writer, files, allowedLanguage));
        } catch (final RejectedExecutionException e) {
            // Worker 池满（workers + queue 全占用）：清理已注册的 cancellation token
            // （不留泄漏），不把永远无 worker 执行的 emitter 返回给客户端，直接抛
            // AiReviewBusyException → @ExceptionHandler 映射 503 AI_REVIEW_BUSY。
            cancellationRegistry.unregister(requestId);
            throw new AiReviewBusyException();
        }
        return emitter;
    }

    /**
     * worker 线程内的完整 AI 复盘生命周期：set AiRequestContext → 流式分析 →
     * done + complete → finally 清理上下文并 unregister cancellation。
     * <p>所有失败（含流尚未开始的校验失败）统一以 {@code error} 事件传达稳定
     * 错误码；客户端断开（SSE 写入失败：IOException 或 emitter 已终止的
     * IllegalStateException）时翻转 cancellation（emitter 已由容器以 error
     * 终止，无需再主动 complete），不向已断开的连接写入。</p>
     */
    private void runAnalysis(final String requestId,
                             final AiCancellationToken cancellation,
                             final SseEmitter emitter,
                             final ReplaySseWriter writer,
                             final MultipartFile[] files,
                             final AllowedLanguage language) {
        AiRequestContext.set(requestId, cancellation);
        try {
            // queued cancellation check：任务在队列中等待期间被取消（客户端断开 /
            // cancel 端点）后获取 worker 时，不调 Replay processing、不调 AI Gateway、
            // 不向已断开的客户端输出 error，直接 complete 并清理。
            if (cancellation.isCancelled()) {
                quietComplete(emitter);
                return;
            }
            final AnalyzeResponse response = reviewService.analyzeStreaming(
                    files, language, new AiReviewStreamListener() {
                        @Override
                        public void onStage(final String stage) {
                            try {
                                writer.stage(stage);
                            } catch (final IOException | IllegalStateException e) {
                                throw new ClientDisconnectedException(e);
                            }
                        }

                        @Override
                        public void onToken(final String delta) {
                            try {
                                writer.token(delta);
                            } catch (final IOException | IllegalStateException e) {
                                throw new ClientDisconnectedException(e);
                            }
                        }
                    });
            writer.done(response);
            emitter.complete();
        } catch (final ClientDisconnectedException e) {
            // 客户端已断开：终止上游调用（cancel 端点语义）；emitter 已由容器以
            // error 终止，无需再主动 complete（finally 完成上下文与 registry 清理）。
            cancellationRegistry.cancel(requestId);
        } catch (final RuntimeException | IOException e) {
            // 流中途失败（含流尚未开始的数据校验失败）：一律以 error 事件传达
            // 稳定错误码（客户端断开时静默），HTTP 层面已返回 200 + SseEmitter。
            try {
                writer.error(errorCodeOf(e));
            } catch (final IOException | IllegalStateException ignored) {
                // 客户端同时断开（写入失败 / emitter 已终止）：无意义，静默。
            }
            quietComplete(emitter);
        } finally {
            // AiRequestContext 是 ThreadLocal：必须在真正执行 AI 的 worker 线程
            // 内清理，绝不能在 request 线程执行（否则一 return 就失效）。
            AiRequestContext.clear();
            cancellationRegistry.unregister(requestId);
        }
    }

    /**
     * Package-private factory so tests can substitute a spy emitter; production
     * timeout aligns with the nginx 420s read timeout.
     */
    SseEmitter newAnalyzeEmitter() {
        return new SseEmitter(SSE_TIMEOUT_MS);
    }

    private static void quietComplete(final SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (final RuntimeException ignored) {
            // 已 complete / 客户端已断开：静默。
        }
    }

    /** 稳定错误码提取（与 {@code @ExceptionHandler} 映射一致）。 */
    private static String errorCodeOf(final Throwable e) {
        if (e instanceof AiUpstreamException upstream) {
            return upstream.code();
        }
        if (e instanceof AiNotConfiguredException) {
            return "AI_NOT_CONFIGURED";
        }
        if (e instanceof AiPromptBudgetExceededException) {
            return "AI_PROMPT_MANDATORY_SECTION_TOO_LARGE";
        }
        if (e instanceof UnsupportedReplayAnalysisModeException) {
            return "UNSUPPORTED_BATTLE_CATEGORY";
        }
        if (e instanceof PerspectiveTeamNotResolvedException pte) {
            // 异常 message 即稳定错误码（PERSPECTIVE_TEAM_CONFLICT / PERSPECTIVE_TEAM_UNRESOLVED）。
            final String message = pte.getMessage();
            return message != null && !message.isBlank()
                    ? message : "PERSPECTIVE_TEAM_UNRESOLVED";
        }
        if (e instanceof ReplayFileCountExceededException) {
            return "REPLAY_FILE_COUNT_EXCEEDED";
        }
        if (e instanceof MixedAnalysisScopesException) {
            return "MIXED_ANALYSIS_SCOPES";
        }
        if (e instanceof MixedRandomBattleRecordersException) {
            return "MIXED_RANDOM_BATTLE_RECORDERS";
        }
        if (e instanceof IllegalArgumentException) {
            final String message = e.getMessage();
            return message != null && !message.isBlank() ? message : "BAD_REQUEST";
        }
        return "AI_UPSTREAM_UNAVAILABLE";
    }

    /**
     * 客户端断开信号：SSE 写入失败（{@link IOException} 或 emitter 已终止时的
     * {@link IllegalStateException}）在流式回调中包装为 RuntimeException 以中断
     * 编排层，由 {@link #runAnalysis} 内的 catch 分支统一处理。
     */
    private static final class ClientDisconnectedException extends RuntimeException {
        ClientDisconnectedException(final Throwable cause) {
            super(cause);
        }
    }

    /**
     * Cancels an in-flight AI Review request by correlation id, so the upstream
     * call is aborted instead of running to completion for a client that no
     * longer waits for it.
     */
    @PostMapping(value = ApiPaths.REPLAY_ANALYZE_CANCEL)
    public ResponseEntity<Void> cancelAnalyze(
            @RequestParam("correlationId") final String correlationId) {
        if (!cancellationRegistry.cancel(correlationId)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.noContent().build();
    }

    /**
     * 批量重建（公开给 admin 使用的新 pipeline）。
     * POST /api/replay/reconstruct-batch
     */
    @PostMapping(value = ApiPaths.REPLAY_RECONSTRUCT_BATCH, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReplayBatchProcessingResult reconstructBatch(
            @RequestParam("files") final MultipartFile[] files) throws IOException {

        validateBatch(files);
        final List<Source> sources = toSources(files);
        return timed(ReplayUsageMetrics.OP_RECONSTRUCT, files.length, () -> processingFacade.processBatch(sources, ReplayProcessingOptions.full()));
    }

    @PostMapping(value = ApiPaths.REPLAY_PROCESS, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
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
        } catch (final IOException | RuntimeException e) {
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
     * AI Review worker 池满（workers + queue 全占用）→ 503 AI_REVIEW_BUSY。
     */
    @ExceptionHandler(AiReviewBusyException.class)
    public ResponseEntity<Map<String, Object>> handleAiReviewBusy(final AiReviewBusyException e) {
        final Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", "AI_REVIEW_BUSY");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
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
        if (name == null || name.isBlank() || !name.toLowerCase().endsWith(".wotbreplay")) {
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

    /**
     * analyze 端点的 request-envelope 校验（servlet request 线程同步执行）：
     * 文件非空 / 数量 ≤ {@link AiReplayBatchPolicy#MAX_FILES} / 每个文件合法 /
     * 总大小 ≤ 上限。失败直接 HTTP 400，不进入 SSE 流。worker 内
     * {@code analyzeInternal} 保留相同校验作为防御。
     */
    private static void validateAnalyzeRequest(final MultipartFile[] files) {
        validateBatch(files);
        if (files.length > AiReplayBatchPolicy.MAX_FILES) {
            throw new ReplayFileCountExceededException(
                    AiReplayBatchPolicy.MAX_FILES, files.length);
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
