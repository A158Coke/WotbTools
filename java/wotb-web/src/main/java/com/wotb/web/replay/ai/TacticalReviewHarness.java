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

    private final PlayerReplayAnalysisService playerService;
    private final PreBattleStrategicService preBattleService;
    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final LongSupplier nanoTimeSource;
    private final EvidenceSkillEngine skillEngine = new EvidenceSkillEngine();

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    @Autowired
    public TacticalReviewHarness(final PlayerReplayAnalysisService playerService,
                                 final PreBattleStrategicService preBattleService,
                                 final AiChatGateway gateway,
                                 final AiReplayAnalysisConfig config) {
        this(playerService, preBattleService, gateway, config, System::nanoTime);
    }

    TacticalReviewHarness(final PlayerReplayAnalysisService playerService,
                          final PreBattleStrategicService preBattleService,
                          final AiChatGateway gateway,
                          final AiReplayAnalysisConfig config,
                          final LongSupplier nanoTimeSource) {
        this.playerService = playerService;
        this.preBattleService = preBattleService;
        this.gateway = gateway;
        this.config = config;
        this.nanoTimeSource = nanoTimeSource;
    }

    /** 运行双 Call Harness；不满足前提时回退到旧单 Call 路径。 */
    public AnalyzeResult analyze(final ReplayProcessingResult result, final AllowedLanguage language) {
        final long startNanos = nanoTimeSource.getAsLong();
        if (language != AllowedLanguage.ZH) {
            return fallback(result, language, "NON_ZH");
        }
        if (result == null || result.battle() == null) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        if (!preBattleService.isConfigured()) {
            return fallback(result, language, "AI_NOT_CONFIGURED");
        }
        if (result.reconstruction() == null) {
            return fallback(result, language, "NO_RECONSTRUCTION");
        }
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(result);
        if (!recorder.resolved()) {
            return fallback(result, language, "RECORDER_UNRESOLVED");
        }
        final PlayerBattleFeatureSet features;
        try {
            features = new DefaultPlayerBattleFeatureExtractor().extract(
                    result.reconstruction(), recorder, result.battle());
        } catch (final RuntimeException e) {
            LOGGER.info("Harness feature extraction failed, falling back: {}", e.getMessage());
            return fallback(result, language, "FEATURES_FAILED");
        }
        if (!features.hasFeatures()) {
            return fallback(result, language, "FEATURES_UNAVAILABLE");
        }

        final PreBattleStrategicPrior prior = preBattleService.analyze(result.battle());
        if (prior == null) {
            if (remainingSeconds(startNanos) < FALLBACK_MIN_REMAINING_SEC) {
                throw new AiUpstreamException(
                        "AI_TIMEOUT", null, AiRequestContext.correlationId());
            }
            return fallback(result, language, "PRE_BATTLE_UNAVAILABLE");
        }

        final EvidenceSkillResult evidence = skillEngine.run(new EvidenceSkillContext(
                result.battle(), result.reconstruction(), features, recorder));
        if (!evidence.hasContent()) {
            return fallback(result, language, "NO_EVIDENCE");
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
                config.thinkingEnabled(),
                config.reasoningEffort(),
                null,
                "TACTICAL_REVIEW_HARNESS",
                (int) Math.min(Math.max(1L, remainingSeconds(startNanos) - SAFETY_MARGIN_SEC),
                        Integer.MAX_VALUE));
        final String text = gateway.chat(request).completionText();
        count("used");
        LOGGER.info("Harness review used: {}", prepared.budgetSummary());
        return new AnalyzeResult(text);
    }

    private AnalyzeResult fallback(final ReplayProcessingResult result,
                                   final AllowedLanguage language,
                                   final String reason) {
        count(reason);
        return playerService.analyzePlayerOrFallback(result, language);
    }

    private void count(final String reason) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_harness_total", "result", reason).increment();
        }
    }

    /** 剩余请求预算（秒）：整体 deadline = 配置的 callTimeoutSec。 */
    private long remainingSeconds(final long startNanos) {
        final long elapsedNanos = nanoTimeSource.getAsLong() - startNanos;
        return Math.max(0L, config.callTimeoutSec() - elapsedNanos / 1_000_000_000L);
    }
}
