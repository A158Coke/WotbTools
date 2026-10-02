package com.wotb.ai;

import com.wotb.core.replay.projection.ClientAiProjection;
import com.wotb.core.replay.projection.ClientAiProjectionAdapter;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.processing.BattleCategoryUtils;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.processing.ReplayAnalysisScope;
import com.wotb.core.replay.processing.UnsupportedBattleCategoryException;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.ai.AiReviewStreamListener;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.AllowedLanguage;
import com.wotb.web.replay.ai.AiReplayAnalysisService;
import com.wotb.web.replay.ai.TacticalReviewHarness;
import com.wotb.web.replay.ai.AnalysisUnitAssembler;
import com.wotb.web.replay.ai.PlayerReviewOutputCorrector;
import com.wotb.web.replay.ai.PreBattleSectionRenderer;
import com.wotb.web.replay.ai.TeamAnalyzeResult;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import com.wotb.web.replay.ai.gateway.AiCancellationToken;
import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import jakarta.servlet.http.HttpServletRequest;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.RejectedExecutionException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@RestController
@RequestMapping("/api/ai/reviews")
public class AiReviewController {
    private static final long SSE_TIMEOUT_MS = 1_120_000L;
    private static final int MAX_REQUEST_BYTES = 16 * 1024 * 1024;

    private final TacticalReviewHarness tacticalReviewHarness;
    private final AiReplayAnalysisService aiReplayAnalysisService;
    private final AiReviewWorkerExecutor workerExecutor;
    private final AiCancellationRegistry cancellations;
    /**
     * Review 侧指标（见 {@code docs/operations/observability.md} §10 的 ai-service 清单）：
     * <b>一次进入 worker 的请求 = 一次 Review</b>；HTTP 4xx/409/413/422/503 预校验失败
     * 不进入 worker，因此不计入这些计数器。
     */
    private final MeterRegistry meterRegistry;
    private final Timer reviewDuration;

    public AiReviewController(final TacticalReviewHarness tacticalReviewHarness,
                              final AiReplayAnalysisService aiReplayAnalysisService,
                              final AiReviewWorkerExecutor workerExecutor,
                              final AiCancellationRegistry cancellations,
                              final MeterRegistry meterRegistry) {
        this.tacticalReviewHarness = tacticalReviewHarness;
        this.aiReplayAnalysisService = aiReplayAnalysisService;
        this.workerExecutor = workerExecutor;
        this.cancellations = cancellations;
        this.meterRegistry = meterRegistry;
        // publishPercentileHistogram 是 Dashboard P50/P95/P99（histogram_quantile）的前提：
        // 不启用则只有 _count/_sum，没有 _bucket。
        this.reviewDuration = Timer.builder("wotb_ai_review_duration_seconds")
                .description("AI Review 完整总耗时（成功与异常都结束）")
                .publishPercentileHistogram()
                .register(meterRegistry);
    }

    public static final int SCHEMA_VERSION = 2;

    /**
     * 解码后的请求：{@code reconstruction} 由 {@link ClientAiProjectionAdapter} 从客户端 canonical AI 投影装配
     * （服务器没有 replay parser），{@code limitations} 为投影声明的能力缺口。
     */
    public record AiReviewRequest(int schemaVersion, String locale, String correlationId,
                                  Battle battle, ReplayReconstruction reconstruction, List<String> limitations) {
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter reviewJson(final HttpServletRequest request) {
        if (request.getContentLengthLong() > MAX_REQUEST_BYTES) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "AI_REQUEST_TOO_LARGE");
        }
        final JsonNode body;
        try {
            final byte[] bytes = readBody(request);
            body = JsonMapper.builder().build().readTree(bytes);
        } catch (final IOException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST");
        }
        if (body == null || !body.isObject() || body.path("schemaVersion").asInt() != SCHEMA_VERSION) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_AI_REQUEST_SCHEMA");
        }
        // 信封先于投影：locale / correlationId 的契约错误不被投影结构错误掩盖
        languageOf(body.path("locale").asString(""));
        if (!AiCancellationRegistry.isValidCorrelationId(body.path("correlationId").asString(""))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID");
        }
        try {
            final Battle battle = ReplayFactsCodec.battleFromJson(body.path("battle"));
            final ClientAiProjection projection = ReplayFactsCodec.projectionFromJson(body.path("projection"));
            final ReplayReconstruction reconstruction = ClientAiProjectionAdapter.toReconstruction(battle, projection);
            ClientAiProjectionAdapter.enrichBattle(battle, reconstruction);
            return review(new AiReviewRequest(SCHEMA_VERSION,
                    body.path("locale").asString(""),
                    body.path("correlationId").asString(""),
                    battle,
                    reconstruction,
                    List.copyOf(projection.limitations())));
        } catch (final IOException | tools.jackson.core.JacksonException | IllegalArgumentException
                       | NullPointerException error) {
            // Jackson 3 的映射异常是 unchecked：结构不合法的投影必须是 400 INVALID_AI_REQUEST，不是 500
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST");
        }
    }

    /**
     * 读取请求体：{@code Content-Encoding: gzip} 时限额解压（传输体与解压后都不得超过 16 MiB，
     * 超限 413——防 zip bomb）。其它编码拒绝。
     */
    static byte[] readBody(final HttpServletRequest request) throws IOException {
        final byte[] raw = request.getInputStream().readNBytes(MAX_REQUEST_BYTES + 1);
        if (raw.length > MAX_REQUEST_BYTES) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "AI_REQUEST_TOO_LARGE");
        }
        final String encoding = request.getHeader("Content-Encoding");
        if (encoding == null || encoding.isBlank() || "identity".equalsIgnoreCase(encoding.trim())) {
            return raw;
        }
        if (!"gzip".equalsIgnoreCase(encoding.trim())) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_CONTENT_ENCODING");
        }
        try (java.util.zip.GZIPInputStream in = new java.util.zip.GZIPInputStream(
                new java.io.ByteArrayInputStream(raw))) {
            final byte[] inflated = in.readNBytes(MAX_REQUEST_BYTES + 1);
            if (inflated.length > MAX_REQUEST_BYTES) {
                throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "AI_REQUEST_TOO_LARGE");
            }
            return inflated;
        } catch (final java.util.zip.ZipException error) {
            throw new IOException("gzip body corrupt", error);
        }
    }

    private static AllowedLanguage languageOf(final String locale) {
        return switch (locale == null ? "" : locale) {
            case "zh-CN" -> AllowedLanguage.ZH;
            case "en-US" -> AllowedLanguage.EN;
            case "ru-RU" -> AllowedLanguage.RU;
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNKNOWN_LOCALE");
        };
    }

    public SseEmitter review(final AiReviewRequest request) {
        if (request == null || request.schemaVersion() != SCHEMA_VERSION) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_AI_REQUEST_SCHEMA");
        }
        if (request.battle() == null || request.battle().players == null
                || request.reconstruction() == null
                || request.reconstruction().participants() == null
                || request.reconstruction().events() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_AI_REQUEST");
        }
        final AllowedLanguage language = languageOf(request.locale());
        if (!AiCancellationRegistry.isValidCorrelationId(request.correlationId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID");
        }
        final ReplayAnalysisScope scope;
        try {
            scope = BattleCategoryUtils.resolveScope(
                    BattleCategoryUtils.fromArenaBonusType(request.battle().arenaBonusType));
        } catch (final UnsupportedBattleCategoryException error) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,
                    "UNSUPPORTED_BATTLE_CATEGORY");
        }
        final AiCancellationToken cancellation = cancellations.register(request.correlationId());
        if (cancellation == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "DUPLICATE_CORRELATION_ID");
        }
        final SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        emitter.onTimeout(() -> cancellations.cancel(request.correlationId()));
        emitter.onError(error -> cancellations.cancel(request.correlationId()));
        try {
            workerExecutor.execute(() -> runReview(request, language, scope, cancellation, emitter));
        } catch (final RejectedExecutionException error) {
            cancellations.unregister(request.correlationId(), cancellation);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI_REVIEW_BUSY");
        }
        return emitter;
    }

    @PostMapping("/{correlationId}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable("correlationId") final String correlationId) {
        if (!AiCancellationRegistry.isValidCorrelationId(correlationId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID");
        }
        if (!cancellations.cancel(correlationId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND");
        }
        return ResponseEntity.noContent().build();
    }

    private void runReview(final AiReviewRequest request, final AllowedLanguage language,
                           final ReplayAnalysisScope scope,
                           final AiCancellationToken cancellation, final SseEmitter emitter) {
        AiRequestContext.set(request.correlationId(), cancellation);
        meterRegistry.counter("wotb_ai_review_requests_total").increment();
        final Timer.Sample durationSample = Timer.start(meterRegistry);
        String result = "success";
        String errorType = null;
        try {
            if (cancellation.isCancelled()) {
                // 未执行任何上游调用即被取消：Review 未产出结果，按流内失败归类。
                result = "failure";
                errorType = "AI_CANCELLED";
                emitter.complete();
                return;
            }
            final AiReviewStreamListener listener = new AiReviewStreamListener() {
                        @Override
                        public void onStage(final String stage) {
                            send(emitter, cancellation, stage, Map.of());
                        }

                        @Override
                        public void onToken(final String delta) {
                            send(emitter, cancellation, "call2_token", Map.of("delta", delta));
                        }
                    };
            final Map<String, Object> done = new HashMap<>();
            if (scope == ReplayAnalysisScope.PLAYER_FOCUSED) {
                requireUsableTimeline(request.battle(), request.reconstruction());
                final TacticalReviewHarness.HarnessOutcome outcome = tacticalReviewHarness.analyzeWithPrior(
                        request.battle(), request.reconstruction(), language, listener);
                final var recorder = AnalysisUnitAssembler.findRecorder(request.battle(), request.reconstruction());
                final String preBattleSection = outcome.preBattlePrior() == null ? null
                        : PreBattleSectionRenderer.renderRandomBattle(outcome.preBattlePrior(),
                                recorder.team() == null ? 0 : recorder.team(), language,
                                request.battle().mapName);
                // 不变量：迁移前 AiReplayReviewService 对随机战输出应用的确定性纠正链
                // （坦克名纠正 → 「簇」兜底 → 三语免责句）必须继续生效。
                final PlayerReviewOutputCorrector.Corrected corrected = PlayerReviewOutputCorrector.apply(
                        outcome.result().analysis(), preBattleSection, request.battle(), language);
                done.put("analysis", corrected.analysis());
                done.put("preBattleSection", corrected.preBattleSection());
                done.put("teamReview", null);
                done.put("teamPlayers", java.util.List.of());
            } else {
                final TeamAnalyzeResult outcome = aiReplayAnalysisService.analyzeTeam(
                        request.battle(), request.reconstruction(), language, listener);
                done.put("analysis", outcome.analysis() == null ? null : outcome.analysis().analysis());
                done.put("preBattleSection", outcome.preBattleSection());
                done.put("teamReview", outcome.structuredResult());
                done.put("teamPlayers", outcome.teamPlayers());
            }
            done.put("capability", request.reconstruction().battleStartRawClockSec() == null
                    || (request.limitations() != null && !request.limitations().isEmpty())
                    ? AnalyzeResponse.Capability.AVAILABLE_WITH_LIMITED_TIMELINE
                    : AnalyzeResponse.Capability.AVAILABLE);
            send(emitter, cancellation, "done", done);
            emitter.complete();
        } catch (final RuntimeException error) {
            result = isRejected(error) ? "rejected" : "failure";
            errorType = errorCodeOf(error);
            if (error instanceof ClientDisconnectedException) {
                cancellations.cancel(request.correlationId());
            }
            if (!(error instanceof ClientDisconnectedException)) {
                try {
                    emitter.send(SseEmitter.event().name("error")
                            .data(Map.of("id", request.correlationId(), "errorCode", errorType)));
                } catch (final IOException | IllegalStateException ignored) {
                    cancellations.cancel(request.correlationId());
                }
            }
            emitter.complete();
        } finally {
            durationSample.stop(reviewDuration);
            meterRegistry.counter("wotb_ai_review_results_total", "result", result).increment();
            if (errorType != null) {
                meterRegistry.counter("wotb_ai_review_errors_total", "type", errorType).increment();
            }
            AiRequestContext.clear();
            cancellations.unregister(request.correlationId(), cancellation);
        }
    }

    /**
     * 流内“事实校验退回”判定：AI 未配置 / 时间线不可用 / prompt 预算拒绝属于
     * {@code result=rejected}（Dashboard 显示为“事实校验退回”），其余流内失败为
     * {@code result=failure}。
     */
    private static boolean isRejected(final RuntimeException error) {
        return error instanceof AiTimelineUnusableException
                || error instanceof AiNotConfiguredException
                || error instanceof AiPromptBudgetExceededException;
    }

    private static String errorCodeOf(final RuntimeException error) {
        if (error instanceof AiTimelineUnusableException) {
            return AiTimelineUnusableException.STABLE_ERROR_CODE;
        }
        if (error instanceof AiUpstreamException upstream) {
            return upstream.code();
        }
        if (error instanceof AiNotConfiguredException) {
            return "AI_NOT_CONFIGURED";
        }
        if (error instanceof AiPromptBudgetExceededException) {
            return "AI_PROMPT_MANDATORY_SECTION_TOO_LARGE";
        }
        return error instanceof ClientDisconnectedException ? "AI_CANCELLED" : "AI_UPSTREAM_UNAVAILABLE";
    }

    private static void requireUsableTimeline(final Battle battle,
                                              final ReplayReconstruction reconstruction) {
        final var recorder = AnalysisUnitAssembler.findRecorder(battle, reconstruction);
        if (recorder.accountId() == null || recorder.team() == null) {
            throw new AiTimelineUnusableException("RECORDER_UNRESOLVED");
        }
        final var result = com.wotb.core.replay.timeline.BattleTimelineBuilder.build(battle, reconstruction,
                com.wotb.core.replay.timeline.TimelinePerspective.personal(
                        recorder.accountId(), recorder.team()));
        if (!result.usable()) {
            throw new AiTimelineUnusableException(result.validation().errors());
        }
    }

    private static void send(final SseEmitter emitter, final AiCancellationToken cancellation,
                             final String event, final Map<String, Object> body) {
        if (cancellation.isCancelled()) {
            throw new ClientDisconnectedException();
        }
        try {
            emitter.send(SseEmitter.event().name(event).data(body));
        } catch (final IOException | IllegalStateException error) {
            // Registry owns cancellation and propagates it to the active upstream call.
            throw new ClientDisconnectedException();
        }
    }

    private static final class ClientDisconnectedException extends RuntimeException {
    }
}
