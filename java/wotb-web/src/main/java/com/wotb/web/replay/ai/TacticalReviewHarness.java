package com.wotb.web.replay.ai;

import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.function.LongSupplier;

/**
 * AI Review Harness 双 Call 编排器（文档 §25/§30）：
 * Call #1（赛前战略基线）→ Backend Evidence Skills → Call #2（Tactical Review）。
 * <p>随机战斗个人复盘不评判 MVP/战犯；Team Autopsy（战犯/MVP）只应用于
 * team perspective（训练房/联赛团队复盘），由 {@link TeamReplayAnalysisService}
 * 以结算级独立 TEAM_AUTOPSY 调用执行。</p>
 * <p>降级阶梯（保持现有单 Call 路径为兜底，用户可感知行为不倒退）：
 * 非 ZH / 无重建 / 录像者未解析 / 特征不可用 / Call #1 失败 / 无证据 → 旧路径。</p>
 */
@Service
public class TacticalReviewHarness {

    private static final Logger LOGGER = LoggerFactory.getLogger(TacticalReviewHarness.class);

    /** Call #1 的硬 stage budget（秒）：小型 roster/map JSON 分析，独立且远短于整体。 */
    static final int CALL_1_BUDGET_SEC = 45;
    /** Call #2 前保留的安全余量（秒），避免恰好在 endpoint deadline 边缘结束。 */
    static final int SAFETY_MARGIN_SEC = 10;
    /** Call #1 失败后进入旧路径 fallback 所需的最小剩余预算（秒）。 */
    static final int FALLBACK_MIN_REMAINING_SEC = 60;
    /** 前端/nginx 的现有请求生命周期上限（秒），用于理论最坏时间断言。 */
    static final int ENDPOINT_DEADLINE_SEC = 400;

    /**
     * Harness 运行结果：复盘文本 + 本次执行实际使用的 Call #1 prior。
     * <p>{@code preBattlePrior} 仅在 ZH + 全部前置满足 + Call #1 成功时非 null
     * （fallback / 非 ZH / 失败均为 null），供上层渲染用户可见的赛前预测区块。</p>
     */
    public record HarnessOutcome(AnalyzeResult result, PreBattleStrategicPrior preBattlePrior) {
    }

    private final PlayerReplayAnalysisService playerService;
    private final PreBattleStrategicService preBattleService;
    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final LongSupplier nanoTimeSource;
    private final EvidenceSkillEngine skillEngine = new EvidenceSkillEngine();
    private final MeterRegistry meterRegistry;

    @Autowired
    public TacticalReviewHarness(final PlayerReplayAnalysisService playerService,
                                 final PreBattleStrategicService preBattleService,
                                 final AiChatGateway gateway,
                                 final AiReplayAnalysisConfig config,
                                 @Autowired(required = false) final MeterRegistry meterRegistry) {
        this(playerService, preBattleService, gateway, config, System::nanoTime, meterRegistry);
    }

    TacticalReviewHarness(final PlayerReplayAnalysisService playerService,
                          final PreBattleStrategicService preBattleService,
                          final AiChatGateway gateway,
                          final AiReplayAnalysisConfig config,
                          final LongSupplier nanoTimeSource,
                          final MeterRegistry meterRegistry) {
        this.playerService = playerService;
        this.preBattleService = preBattleService;
        this.gateway = gateway;
        this.config = config;
        this.nanoTimeSource = nanoTimeSource;
        this.meterRegistry = meterRegistry;
    }

    /** 运行双 Call Harness；不满足前提时回退到旧单 Call 路径。 */
    public AnalyzeResult analyze(final ReplayProcessingResult result, final AllowedLanguage language) {
        return analyzeWithPrior(result, language, AiReviewStreamListener.NOOP).result();
    }

    /**
     * 运行双 Call Harness 并暴露本次执行实际使用的 Call #1 prior
     * （仅 ZH 全路径成功时非 null，供上层渲染用户可见赛前预测区块）；
     * 通过 {@code listener} 广播阶段事件（call1_start/call1_done/evidence_done）
     * 与 Call #2 主复盘 token 增量（call2_token）。
     */
    public HarnessOutcome analyzeWithPrior(final ReplayProcessingResult result,
                                           final AllowedLanguage language,
                                           final AiReviewStreamListener listener) {
        final long startNanos = budgetStartNanos();
        if (remainingSeconds(startNanos) < SAFETY_MARGIN_SEC) {
            // 预算起点回溯到提交时刻（now + overall）：排队计入剩余预算，
            // 启动时剩余不足直接干净失败 AI_TIMEOUT。
            LOGGER.info("Harness overall deadline exhausted before start, aborting with AI_TIMEOUT");
            throw new AiUpstreamException("AI_TIMEOUT", 504, AiRequestContext.correlationId());
        }
        if (language != AllowedLanguage.ZH) {
            return new HarnessOutcome(fallback(result, language, "NON_ZH", listener), null);
        }
        if (result == null || result.battle() == null) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        if (!preBattleService.isConfigured()) {
            return new HarnessOutcome(fallback(result, language, "AI_NOT_CONFIGURED", listener), null);
        }
        if (result.reconstruction() == null) {
            return new HarnessOutcome(fallback(result, language, "NO_RECONSTRUCTION", listener), null);
        }
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result);
        if (!recorder.resolved()) {
            return new HarnessOutcome(fallback(result, language, "RECORDER_UNRESOLVED", listener), null);
        }
        final PlayerBattleFeatureSet features;
        try {
            features = new DefaultPlayerBattleFeatureExtractor().extract(
                    result.reconstruction(), recorder, result.battle());
        } catch (final RuntimeException e) {
            LOGGER.info("Harness feature extraction failed, falling back: {}", e.getMessage());
            return new HarnessOutcome(fallback(result, language, "FEATURES_FAILED", listener), null);
        }
        if (!features.hasFeatures()) {
            return new HarnessOutcome(fallback(result, language, "FEATURES_UNAVAILABLE", listener), null);
        }

        final PreBattleStrategicPrior prior = preBattleService.analyze(result.battle(), listener);
        if (prior == null) {
            if (remainingSeconds(startNanos) < FALLBACK_MIN_REMAINING_SEC) {
                LOGGER.info("Harness prior unavailable and budget insufficient, aborting with AI_TIMEOUT");
                throw new AiUpstreamException(
                        "AI_TIMEOUT", null, AiRequestContext.correlationId());
            }
            return new HarnessOutcome(fallback(result, language, "PRE_BATTLE_UNAVAILABLE", listener), null);
        }
        LOGGER.info("Harness prior obtained: hypotheses={} matchups={} winConditions={}",
                prior.hypotheses().size(),
                prior.keyMatchups().size(),
                prior.strategicWinConditions().size());

        final EvidenceSkillResult evidence = skillEngine.run(new EvidenceSkillContext(
                result.battle(), result.reconstruction(), features, recorder));
        listener.onStage("evidence_done");
        if (!evidence.hasContent()) {
            return new HarnessOutcome(fallback(result, language, "NO_EVIDENCE", listener), null);
        }

        final TacticalReviewPromptBuilder.PreparedHarnessPrompt prepared =
                TacticalReviewPromptBuilder.prepare(
                        prior,
                        evidence,
                        result.battle(),
                        result.reconstruction(),
                        features,
                        recorder,
                        config.estimator(),
                        config.singleReplayMaxInputTokens(),
                        config.contextWindowTokens(),
                        config.maxOutputTokens(),
                        config.promptSafetyMarginTokens());
        AiPromptBudgetGuard.enforce(
                prepared.estimatedInputTokens(),
                config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(),
                config.maxOutputTokens(),
                config.promptSafetyMarginTokens());
        final AiChatRequest request = new AiChatRequest(
                prepared.systemPrompt(),
                prepared.userContent(),
                config.model(),
                null,
                config.maxOutputTokens(),
                config.call2ThinkingEnabled(),
                config.call2ThinkingEnabled() ? config.reasoningEffort() : null,
                null,
                "TACTICAL_REVIEW_HARNESS",
                (int) Math.min(Math.max(1L, remainingSeconds(startNanos) - SAFETY_MARGIN_SEC),
                        Integer.MAX_VALUE));
        final String text = gateway.stream(request, listener::onToken).completionText();
        count("used");
        LOGGER.info("Harness review used: {}", prepared.budgetSummary());
        return new HarnessOutcome(new AnalyzeResult(text), prior);
    }

    private AnalyzeResult fallback(final ReplayProcessingResult result,
                                   final AllowedLanguage language,
                                   final String reason,
                                   final AiReviewStreamListener listener) {
        LOGGER.info("Harness fell back to old path: {}", reason);
        count(reason);
        return playerService.analyzePlayerOrFallback(result, language, listener);
    }

    private void count(final String reason) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_harness_total", "result", reason).increment();
        }
    }

    /**
     * 剩余请求预算（秒）：整体 deadline = 配置的 callTimeoutSec；
     * 有 worker 整体 deadline 时预算起点回溯到提交时刻（排队计入预算），
     * 无 deadline（直接调用）时用当前时间。
     */
    private long budgetStartNanos() {
        final Long deadline = AiRequestContext.overallDeadlineNanos();
        if (deadline == null) {
            return nanoTimeSource.getAsLong();
        }
        return deadline - config.callTimeoutSec() * 1_000_000_000L;
    }

    private long remainingSeconds(final long startNanos) {
        final long elapsedNanos = nanoTimeSource.getAsLong() - startNanos;
        return Math.max(0L, config.callTimeoutSec() - elapsedNanos / 1_000_000_000L);
    }
}
