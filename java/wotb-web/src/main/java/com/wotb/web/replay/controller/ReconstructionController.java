package com.wotb.web.replay.controller;

import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.processing.MixedAnalysisScopesException;
import com.wotb.core.replay.processing.MixedRandomBattleRecordersException;
import com.wotb.core.replay.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.replay.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewEventLog;
import com.wotb.web.replay.ai.AiReviewStreamListener;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiCancellationToken;
import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.config.ApiPaths;
import com.wotb.web.replay.ReplayLegacyEndpoints;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import com.wotb.web.replay.exception.AiReviewBusyException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;

/**
 * AI 复盘与批量处理 REST API。
 * <p>
 * 需要 wotbtools-user 或 wotbtools-admin 角色（见 {@code SecurityConfig}）。
 * AI Review 只消费 Processing Dataset（JSON body：{@code processingJobId + sourceId}），
 * 由 {@link AiReplayReviewService#analyzeFacts} 读 derived {@code ai-facts.json}，
 * <b>不</b>重新上传 / 不重新 full-process（multipart Analyze 已废弃为 410 兼容 shim）。
 * </p>
 */
@RestController
@CrossOrigin(origins = "*")
public class ReconstructionController {

    /** Dataset 路径 AI 复盘请求体（API 纯英文 key）。 */
    public record AnalyzeDatasetRequest(String processingJobId, String sourceId,
                                        String lang, String correlationId) {
    }

    private static final Logger LOGGER = LoggerFactory.getLogger(ReconstructionController.class);

    private final AiReplayReviewService reviewService;
    private final AiCancellationRegistry cancellationRegistry;
    private final AiReviewWorkerExecutor workerExecutor;
    private final MapOverviewQueryService mapOverviewService;

    /**
     * SSE 连接超时：对齐 nginx analyze 1120s read timeout，避免服务端在代理之前
     * 提前关闭长流。
     */
    /** 公开给配置契约测试（AiTimeoutChainContractTest）校验与 nginx 代理超时对齐。 */
    public static final long SSE_TIMEOUT_MS = 1_120_000L;

    @Autowired
    public ReconstructionController(
            final AiReplayReviewService reviewService,
            final AiCancellationRegistry cancellationRegistry,
            final AiReviewWorkerExecutor workerExecutor,
            final MapOverviewQueryService mapOverviewService) {
        this.reviewService = reviewService;
        this.cancellationRegistry = cancellationRegistry;
        this.workerExecutor = workerExecutor;
        this.mapOverviewService = mapOverviewService;
    }

    /**
     * Legacy multipart Analyze —— 固定的 410 兼容 shim（AI Review 已完全改为
     * Processing Dataset 引用，见 {@link #analyzeDataset} JSON 路径）。此端点绝不
     * 重新上传 / 重新 full-process，只返回 {@code REPLAY_LEGACY_DEPRECATED}。
     */
    @PostMapping(value = ApiPaths.REPLAY_ANALYZE, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public SseEmitter analyze(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "lang", required = true) final String lang,
            @RequestParam(name = "correlationId", required = false) final String correlationId) {
        throw ReplayLegacyEndpoints.gone();
    }

    /**
     * AI 复盘 Dataset 路径：请求体为 {@code {processingJobId, sourceId,
     * lang, correlationId}}，AI 只读 derived {@code ai-facts.json}，<b>不</b>重新上传 /
     * 不重新 full process。
     * <p>SSE 异步模型：request 线程只做 reference / {@code lang} / {@code correlationId}
     * 校验，注册 cancellation、创建 {@link SseEmitter} 并把分析提交到
     * {@link AiReviewWorkerExecutor} 后立即返回。worker 线程内 acquire Processing
     * Dataset lease → {@link com.wotb.web.replay.job.ReplayArtifactWriter#readAiFacts}
     * → AI pipeline → 流式 SSE → release lease；失败以 {@code error} 事件携带稳定错误码传达。</p>
     */
    @PostMapping(value = ApiPaths.REPLAY_ANALYZE, consumes = MediaType.APPLICATION_JSON_VALUE)
    public SseEmitter analyzeDataset(@RequestBody final AnalyzeDatasetRequest request) {
        // 显式 reference 校验（缺失 → 400 DATASET_REFERENCE_REQUIRED），
        // 杜绝 null processingJobId / sourceId 进入 store 查找 NPE → 500。
        requireDatasetReference(request);
        final AllowedLanguage allowedLanguage = AllowedLanguage.fromCode(request.lang());
        if (allowedLanguage == null) {
            throw new IllegalArgumentException("UNKNOWN_LOCALE");
        }
        final int sourceIndex = parseSourceIndex(request.sourceId());
        if (correlationIdInvalid(request.correlationId())) {
            throw new IllegalArgumentException("INVALID_CORRELATION_ID");
        }
        // AI 是 SSE 流式端点：job 不存在/过期（404 JOB_NOT_FOUND）与 source 未 READY
        // （409 SOURCE_NOT_READY）由 worker 内 analyzeFacts 的稳定 ResponseStatusException
        // 经 errorCodeOf 转为 SSE error 事件（与 map-overview 同步端点同一套稳定码，
        // 传输形态因端点类型而异）；此处只做同步 reference 字段校验（400）。
        final String requestId = request.correlationId() != null && !request.correlationId().isBlank()
                ? request.correlationId() : UUID.randomUUID().toString();
        final AiCancellationToken cancellation = cancellationRegistry.register(requestId);
        if (cancellation == null) {
            throw new IllegalArgumentException("DUPLICATE_CORRELATION_ID");
        }
        final SseEmitter emitter = newAnalyzeEmitter();
        final ReplaySseWriter writer = new ReplaySseWriter(emitter);
        emitter.onTimeout(() -> cancellationRegistry.cancel(requestId));
        emitter.onError(error -> cancellationRegistry.cancel(requestId));
        LOGGER.info(AiReviewEventLog.line("ai_review_sse_opened", requestId, "source", "dataset"));
        try {
            workerExecutor.execute(() -> runAnalysis(requestId, cancellation, emitter, writer,
                    allowedLanguage, listener -> reviewService.analyzeFacts(
                            request.processingJobId(), sourceIndex, allowedLanguage, listener)));
        } catch (final RejectedExecutionException e) {
            cancellationRegistry.unregister(requestId, cancellation);
            throw new AiReviewBusyException();
        }
        return emitter;
    }

    /** sourceId 形如 {@code r0} / {@code r12}；非法/缺失 → 400 SOURCE_NOT_FOUND。 */
    private static int parseSourceIndex(final String sourceId) {
        if (sourceId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SOURCE_NOT_FOUND");
        }
        final java.util.regex.Matcher m = java.util.regex.Pattern.compile("^r(\\d+)$").matcher(sourceId.trim());
        if (!m.matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SOURCE_NOT_FOUND");
        }
        return Integer.parseInt(m.group(1));
    }

    /** 缺失/空 reference（含 null request body）→ 400 DATASET_REFERENCE_REQUIRED。 */
    private static void requireDatasetReference(final Object request) {
        final String processingJobId;
        final String sourceId;
        if (request instanceof AnalyzeDatasetRequest r) {
            processingJobId = r.processingJobId();
            sourceId = r.sourceId();
        } else if (request instanceof MapOverviewDatasetRequest r) {
            processingJobId = r.processingJobId();
            sourceId = r.sourceId();
        } else {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED");
        }
        if (processingJobId == null || processingJobId.isBlank()
                || sourceId == null || sourceId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED");
        }
    }

    private static boolean correlationIdInvalid(final String correlationId) {
        return correlationId != null && !correlationId.isBlank()
                && !AiCancellationRegistry.isValidCorrelationId(correlationId);
    }

    /** worker 内 Dataset AI 复盘执行器（acquire dataset lease → read ai-facts → AI pipeline → SSE；multipart analyze 已 410，不会进入 worker）。 */
    @FunctionalInterface
    private interface AnalysisInvoker {
        AnalyzeResponse invoke(AiReviewStreamListener listener) throws IOException;
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
                             final AllowedLanguage language,
                             final AnalysisInvoker invoker) {
        AiRequestContext.set(requestId, cancellation);
        final long workerStartNanos = System.nanoTime();
        try {
            // queued cancellation check：任务在队列中等待期间被取消（客户端断开 /
            // cancel 端点）后获取 worker 时，不调 Replay processing、不调 AI Gateway、
            // 不向已断开的客户端输出 error，直接 complete 并清理。
            if (cancellation.isCancelled()) {
                LOGGER.info(AiReviewEventLog.line("ai_review_cancelled", requestId,
                        "source", "CANCELLED_WHILE_QUEUED"));
                // 统一终态 exactly once——queued cancellation 也是
                // worker 生命周期的一部分，必须与 success/failure 一样恰好记录一次 ai_review_finished。
                LOGGER.info(AiReviewEventLog.line("ai_review_finished", requestId,
                        "result", "CANCELLED",
                        "source", "CANCELLED_WHILE_QUEUED",
                        "durationMs", elapsedMillis(workerStartNanos)));
                quietComplete(emitter);
                return;
            }
            // docs/architecture/ai-review.md：AI Review 生命周期开始（只记录低基数 metadata，
            // 不记录文件名/上传内容；workerQueueWaitMs 见 worker executor 的 debug 日志）。
            LOGGER.info(AiReviewEventLog.line("ai_review_started", requestId,
                    "language", language == null ? "N/A" : language.code()));
            final AnalyzeResponse response = invoker.invoke(new AiReviewStreamListener() {
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
            // docs/architecture/ai-review.md：SSE 完成 + 统一终态 ai_review_finished（exactly once）。
            // 成功路径 result=SUCCESS；失败/取消路径见下方 catch——try / catch(ClientDisconnected) /
            // catch(RuntimeException|IOException) 三分支互斥，每分支各自恰好记录一次终态。
            LOGGER.info(AiReviewEventLog.line("ai_review_sse_completed", requestId,
                    "durationMs", elapsedMillis(workerStartNanos)));
            LOGGER.info(AiReviewEventLog.line("ai_review_finished", requestId,
                    "result", "SUCCESS",
                    "durationMs", elapsedMillis(workerStartNanos)));
        } catch (final ClientDisconnectedException e) {
            // 客户端已断开：终止上游调用（cancel 端点语义）；emitter 已由容器以
            // error 终止，无需再主动 complete（finally 完成上下文与 registry 清理）。
            cancellationRegistry.cancel(requestId);
            LOGGER.info(AiReviewEventLog.line("ai_review_cancelled", requestId,
                    "source", "SSE_DISCONNECT"));
            // 终态 exactly once——SSE 断开 = CANCELLED 终态。
            LOGGER.info(AiReviewEventLog.line("ai_review_finished", requestId,
                    "result", "CANCELLED",
                    "source", "SSE_DISCONNECT",
                    "durationMs", elapsedMillis(workerStartNanos)));
        } catch (final RuntimeException | IOException e) {
            // 流中途失败（含流尚未开始的数据校验失败）：一律以 error 事件传达
            // 稳定错误码（客户端断开时静默），HTTP 层面已返回 200 + SseEmitter。
            final String errorCode = errorCodeOf(e);
            LOGGER.warn(AiReviewEventLog.line("ai_review_failed", requestId,
                    "errorCode", errorCode,
                    "exceptionClass", e.getClass().getSimpleName(),
                    "elapsedMs", elapsedMillis(workerStartNanos)));
            try {
                writer.error(errorCode);
            } catch (final RuntimeException | IOException ignored) {
                // 客户端同时断开（写入失败 / emitter 已终止）：无意义，静默。兜住 IOException 与
                // 一切 RuntimeException（含 IllegalStateException）——否则 writer.error 自身失败
                // 会让本分支逃逸，导致下方 ai_review_finished 终态缺失（exactly once 契约破坏）。
            }
            quietComplete(emitter);
            // 终态 exactly once——任何失败都恰好记录一次
            // ai_review_finished result=FAILED；稳定 errorCode 保留失败细节
            // （AI_REVIEW_GROUNDING_FAILED / AI_TIMEOUT / AI_RATE_LIMITED 等）。
            LOGGER.info(AiReviewEventLog.line("ai_review_finished", requestId,
                    "result", "FAILED",
                    "errorCode", errorCode,
                    "durationMs", elapsedMillis(workerStartNanos)));
        } finally {
            // AiRequestContext 是 ThreadLocal：必须在真正执行 AI 的 worker 线程
            // 内清理，绝不能在 request 线程执行（否则一 return 就失效）。
            AiRequestContext.clear();
            cancellationRegistry.unregister(requestId, cancellation);
        }
    }

    /**
     * Package-private factory so tests can substitute a spy emitter; production
     * timeout aligns with the nginx 1120s read timeout.
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

    /**
     * 稳定错误码提取（与 {@code @ExceptionHandler} 映射一致）。
     * <p>SSE 错误契约：对任何 {@link AiTimelineUnusableException} 只输出
     * {@link AiTimelineUnusableException#STABLE_ERROR_CODE}；异常 message 冒号后的
     * validation detail（{@code TIMELINE_*} / {@code NO_RECONSTRUCTION}）仅供后端
     * 日志，绝不进入 SSE error 事件 / 客户端协议（GlobalExceptionHandler 同步路径按
     * 冒号前前缀提取同一稳定码，message 前缀由异常构造函数保证单一来源）。</p>
     */
    static String errorCodeOf(final Throwable e) {
        if (e instanceof AiTimelineUnusableException) {
            return AiTimelineUnusableException.STABLE_ERROR_CODE;
        }
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
        if (e instanceof ResponseStatusException rse) {
            // Dataset reference 稳定码（JOB_NOT_FOUND / SOURCE_NOT_READY / ...）。
            final String reason = rse.getReason();
            return reason != null && !reason.isBlank() ? reason : "DATASET_REFERENCE_ERROR";
        }
        if (e instanceof IllegalArgumentException) {
            final String message = e.getMessage();
            return message != null && !message.isBlank() ? message : "BAD_REQUEST";
        }
        return "AI_UPSTREAM_UNAVAILABLE";
    }

    private static long elapsedMillis(final long startNanos) {
        return Math.max(0L, (System.nanoTime() - startNanos) / 1_000_000L);
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
        if (!AiCancellationRegistry.isValidCorrelationId(correlationId)) {
            throw new IllegalArgumentException("INVALID_CORRELATION_ID");
        }
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
    public Object reconstructBatch(
            @RequestParam("files") final MultipartFile[] files) throws IOException {
        // V2：批量重建不再单独暴露 multipart 端点（重建由 Processing Job full
        // process 统一产出，经 scheduler 调度）。稳定 410，绝不绕过 scheduler。
        throw ReplayLegacyEndpoints.gone();
    }

    @PostMapping(value = ApiPaths.REPLAY_PROCESS, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object process(
            @RequestParam("files") final MultipartFile[] files,
            @RequestParam(name = "reconstruct", defaultValue = "false") final boolean doReconstruct) throws IOException {
        // V2：同步批量处理已废弃（前端统一走 Processing Job + scheduler）。稳定 410。
        throw ReplayLegacyEndpoints.gone();
    }

    /**
     * 地图鸟瞰（不调 AI）：只解析回放并确定性生成 MapOverview（热力/路线/战局回放）。
     * AI Review 页面在不需要 AI 复盘时单独加载地图视图；错误码与 analyze 一致
     * （文件校验 / NO_BATTLE_DATA），地图不可构建（未知地图/无观测/无名册/视角未解析）
     * 返回 204 空响应，由前端显示不可用提示。
     */
    @PostMapping(value = ApiPaths.REPLAY_MAP_OVERVIEW, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MapOverview> mapOverview(
            @RequestParam("files") final MultipartFile[] files) throws IOException {
        // V2：multipart 地图鸟瞰已废弃（战局回放只读 Processing Job 的 cached
        // map-overview.json，见 mapOverviewDataset JSON 路径）。稳定 410。
        throw ReplayLegacyEndpoints.gone();
    }

    /** 战局回放 Dataset 路径：读 cached map-overview.json，不重新 full process。 */
    @PostMapping(value = ApiPaths.REPLAY_MAP_OVERVIEW, consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<MapOverview> mapOverviewDataset(
            @RequestBody final MapOverviewDatasetRequest request) {
        // 显式 reference 校验（缺失 → 400），杜绝 null 进 store NPE → 500。
        requireDatasetReference(request);
        final MapOverview overview = mapOverviewService.buildOverviewFromDataset(
                request.processingJobId(), parseSourceIndex(request.sourceId()));
        if (overview == null) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.ok(overview);
    }

    /** 战局回放 Dataset 请求体（API 纯英文 key）。 */
    public record MapOverviewDatasetRequest(String processingJobId, String sourceId) {
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

    // ---- 辅助 ----

}
