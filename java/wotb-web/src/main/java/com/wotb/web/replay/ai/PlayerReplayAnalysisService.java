package com.wotb.web.replay.ai;

import java.util.List;
import java.util.Map;

import com.wotb.core.ai.EvidenceDensity;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;

import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 单玩家/多场趋势 AI 复盘编排。
 * <p>职责仅限：接收 Player 业务上下文 → 调 {@link PlayerReplayPromptBuilder}
 * 产出 {@link PreparedAiPrompt} → 通过 {@link AiPromptBudgetGuard} 复核预算
 * → 调 {@link AiChatGateway} → 组装 {@link AnalyzeResult}。</p>
 * <p>不构建 Prompt 文本、不发送 HTTP、不处理 Provider DTO、不含团队编排。</p>
 */
@Service
public class PlayerReplayAnalysisService {

    private static final Logger LOGGER = LoggerFactory.getLogger(PlayerReplayAnalysisService.class);

    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;

    public PlayerReplayAnalysisService(final AiChatGateway gateway,
                                       final AiReplayAnalysisConfig config) {
        this.gateway = gateway;
        this.config = config;
    }

    public boolean isConfigured() {
        return gateway.isConfigured();
    }

    /**
     * 基于结算数据（权威）生成单场战术复盘（fallback 路径）。
     */
    public AnalyzeResult analyze(final Battle battle, final ReplayReconstruction recon) {
        return analyze(battle, recon, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyze(final Battle battle, final ReplayReconstruction recon,
                                 final AllowedLanguage language) {
        return analyze(battle, recon, language, AiReviewStreamListener.NOOP);
    }

    public AnalyzeResult analyze(final Battle battle, final ReplayReconstruction recon,
                                 final AllowedLanguage language,
                                 final AiReviewStreamListener listener) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }
        final PreparedAiPrompt prepared =
                PlayerReplayPromptBuilder.prepareFallback(battle, recon, language);
        return new AnalyzeResult(chat(prepared, listener));
    }

    /**
     * 基于完整 battle + reconstruction + feature set 生成单场个人复盘。
     * <p><b>非 production AI Review entrypoint（PR #102 顺手检查）</b>：本组
     * {@code analyzePlayerContext(ctx[, recon], ...)} 重载只被历史测试/兼容 API 使用；
     * production 个人复盘必须走 {@link #analyzePlayerOrFallback}（其中无重建 / 录像者未解析 /
     * canonical timeline 不可用 → {@code AiTimelineUnusableException} hard reject，见
     * docs/architecture/ai-review.md §3）。若未来出现 production caller，必须先执行 canonical
     * Timeline hard gate，否则构成 hard-gate bypass。</p>
     */
    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx) {
        return analyzePlayerContext(ctx, AllowedLanguage.ZH);
    }

    /** 见 {@link #analyzePlayerContext(SinglePlayerBattleAnalysisContext)}：非 production entrypoint。 */
    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final AllowedLanguage language) {
        if (!isConfigured()) throw new AiNotConfiguredException();
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFullNoRecon(
                ctx, config.estimator(), config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(), config.maxOutputTokens(),
                config.promptSafetyMarginTokens(), language);
        return new AnalyzeResult(chat(prepared, AiReviewStreamListener.NOOP));
    }

    /**
     * 基于完整 battle + reconstruction + feature set 生成单场个人复盘（含重建）。
     */
    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                             final ReplayReconstruction recon) {
        return analyzePlayerContext(ctx, recon, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final ReplayReconstruction recon,
                                              final AllowedLanguage language) {
        return analyzePlayerContext(ctx, recon, language, AiReviewStreamListener.NOOP);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final ReplayReconstruction recon,
                                              final AllowedLanguage language,
                                              final AiReviewStreamListener listener) {
        if (!isConfigured()) throw new AiNotConfiguredException();
        if (recon == null) {
            return analyzePlayerContext(ctx, language);
        }
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFull(
                ctx, recon, config.estimator(), config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(), config.maxOutputTokens(),
                config.promptSafetyMarginTokens(), language);
        if (prepared.density() != EvidenceDensity.LEVEL_1_COMPRESSED) {
            LOGGER.info(
                    "AI analysis density={} tokens={}/{} analysisMode={}",
                    prepared.density(), prepared.estimatedInputTokens(),
                    config.singleReplayMaxInputTokens(), prepared.analysisMode());
        }
        return new AnalyzeResult(chat(prepared, listener));
    }

    /**
     * 单场分析：先尝试完整特征分析，不满足条件时降级到结算分析。
     * <p>fallback 是延迟执行的控制流，不提前调用 AI。</p>
     */
    public AnalyzeResult analyzePlayerOrFallback(final ReplayProcessingResult result) {
        return analyzePlayerOrFallback(result, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyzePlayerOrFallback(final ReplayProcessingResult result,
                                                 final AllowedLanguage language) {
        return analyzePlayerOrFallback(result, language, AiReviewStreamListener.NOOP);
    }

    public AnalyzeResult analyzePlayerOrFallback(final ReplayProcessingResult result,
                                                 final AllowedLanguage language,
                                                 final AiReviewStreamListener listener) {
        if (result.battle() == null) throw new IllegalArgumentException("NO_BATTLE_DATA");
        // docs/architecture/ai-review.md §3：无法构建 canonical BattleTimeline → 拒绝 AI Review，
        // 禁止 settlement-only fallback 仍然调用 AI。
        if (result.reconstruction() == null) {
            throw new AiTimelineUnusableException("NO_RECONSTRUCTION");
        }

        final var recorder = AnalysisUnitAssembler.findRecorder(result);
        if (!recorder.resolved()) {
            throw new AiTimelineUnusableException("RECORDER_UNRESOLVED");
        }
        // 个人复盘 Timeline 门禁：recorder 身份可用后立即构建 canonical timeline
        final BattleTimelineResult timelineResult = BattleTimelineBuilder.build(
                result.battle(), result.reconstruction(),
                TimelinePerspective.personal(recorder.accountId(), recorder.team()));
        if (!timelineResult.usable()) {
            throw new AiTimelineUnusableException(timelineResult.validation().errors());
        }

        final PlayerBattleFeatureSet features;
        try {
            features = new DefaultPlayerBattleFeatureExtractor()
                    .extract(result.reconstruction(), recorder, result.battle());
        } catch (RuntimeException e) {
            LOGGER.warn("Feature extraction failed, falling back: {}", e.getMessage());
            return analyze(result.battle(), result.reconstruction(), language, listener);
        }

        if (!features.hasFeatures()) {
            return analyze(result.battle(), result.reconstruction(), language, listener);
        }

        return analyzePlayerContext(new SinglePlayerBattleAnalysisContext(
                null, result.battle(), features, recorder,
                result.reconstruction().coverage(), features.limitations()),
                result.reconstruction(), language, listener);
    }

    /**
     * 通过 {@link AiChatGateway} 发送 {@link PreparedAiPrompt}，返回 completion 文本。
     * <p>Builder 内部已做一次预算检查；此处再由 {@link AiPromptBudgetGuard} 复核一次，
     * 保证任何路径在 Gateway 调用前都被守一次。</p>
     */
    private String chat(final PreparedAiPrompt prepared,
                        final AiReviewStreamListener listener) {
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", prepared.systemPrompt()),
                Map.<String, Object>of("role", "user", "content", prepared.userPrompt()));
        AiPromptBudgetGuard.enforce(
                config.estimator().estimateMessagesTokens(messages),
                config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(),
                config.maxOutputTokens(),
                config.promptSafetyMarginTokens());
        final AiChatRequest request = new AiChatRequest(
                prepared.systemPrompt(),
                prepared.userPrompt(),
                config.model(),
                null,
                config.maxOutputTokens(),
                config.call2ThinkingEnabled(),
                config.call2ThinkingEnabled() ? config.reasoningEffort() : null,
                null,
                prepared.analysisMode());
        return gateway.stream(request, listener::onToken).completionText();
    }
}
