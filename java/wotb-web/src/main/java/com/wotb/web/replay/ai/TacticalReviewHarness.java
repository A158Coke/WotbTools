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
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * AI Review Harness V1 编排器（文档 §25/§30）：
 * Call #1（赛前战略基线）→ Backend Evidence Skills → Call #2（Tactical Review）。
 * <p>降级阶梯（保持现有单 Call 路径为兜底，用户可感知行为不倒退）：
 * 非 ZH / 无重建 / 录像者未解析 / 特征不可用 / Call #1 失败 / 无证据 → 旧路径。</p>
 */
@Service
public class TacticalReviewHarness {

    private static final Logger LOGGER = LoggerFactory.getLogger(TacticalReviewHarness.class);

    private final PlayerReplayAnalysisService playerService;
    private final PreBattleStrategicService preBattleService;
    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final EvidenceSkillEngine skillEngine = new EvidenceSkillEngine();

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    public TacticalReviewHarness(final PlayerReplayAnalysisService playerService,
                                 final PreBattleStrategicService preBattleService,
                                 final AiChatGateway gateway,
                                 final AiReplayAnalysisConfig config) {
        this.playerService = playerService;
        this.preBattleService = preBattleService;
        this.gateway = gateway;
        this.config = config;
    }

    /**
     * 运行两 Call Harness；不满足前提时回退到旧单 Call 路径。
     */
    public AnalyzeResult analyze(final ReplayProcessingResult result, final AllowedLanguage language) {
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
                "TACTICAL_REVIEW_HARNESS");
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
}
