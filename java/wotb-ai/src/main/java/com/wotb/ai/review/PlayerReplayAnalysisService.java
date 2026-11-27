package com.wotb.ai.review;

import com.wotb.core.ai.EvidenceDensity;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.ai.gateway.AiChatGateway;
import com.wotb.ai.gateway.AiChatRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

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

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx) {
        return analyzePlayerContext(ctx, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyzePlayerContext(final SinglePlayerBattleAnalysisContext ctx,
                                              final AllowedLanguage language) {
        if (!isConfigured()) throw new AiNotConfiguredException();
        final PreparedAiPrompt prepared = PlayerReplayPromptBuilder.prepareFullNoRecon(
                ctx, config.estimator(), config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(), config.maxOutputTokens(),
                config.promptSafetyMarginTokens(), language);
        return new AnalyzeResult(chat(prepared, AiReviewStreamListener.NOOP));
    }

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

    public AnalyzeResult analyzePlayerOrFallback(final Battle battle,
                                                 final ReplayReconstruction reconstruction,
                                                 final AllowedLanguage language,
                                                 final AiReviewStreamListener listener) {
        if (battle == null) throw new IllegalArgumentException("NO_BATTLE_DATA");
        if (reconstruction == null) {
            throw new AiTimelineUnusableException("NO_RECONSTRUCTION");
        }

        final var recorder = AnalysisUnitAssembler.findRecorder(battle, reconstruction);
        if (!recorder.resolved()) {
            throw new AiTimelineUnusableException("RECORDER_UNRESOLVED");
        }
        final BattleTimelineResult timelineResult = BattleTimelineBuilder.build(
                battle, reconstruction,
                TimelinePerspective.personal(recorder.accountId(), recorder.team()));
        if (!timelineResult.usable()) {
            throw new AiTimelineUnusableException(timelineResult.validation().errors());
        }

        final PlayerBattleFeatureSet features;
        try {
            features = new DefaultPlayerBattleFeatureExtractor()
                    .extract(reconstruction, recorder, battle);
        } catch (RuntimeException e) {
            LOGGER.warn("Feature extraction failed, falling back: {}", e.getMessage());
            return analyze(battle, reconstruction, language, listener);
        }

        if (!features.hasFeatures()) {
            return analyze(battle, reconstruction, language, listener);
        }

        return analyzePlayerContext(new SinglePlayerBattleAnalysisContext(
                null, battle, features, recorder,
                reconstruction.coverage(), features.limitations()),
                reconstruction, language, listener);
    }

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
