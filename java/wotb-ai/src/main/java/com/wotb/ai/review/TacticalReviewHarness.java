package com.wotb.ai.review;

import com.wotb.core.replay.evidence.EvidenceSkillContext;
import com.wotb.core.replay.evidence.EvidenceSkillEngine;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.feature.DefaultPlayerBattleFeatureExtractor;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.ai.gateway.AiChatGateway;
import com.wotb.ai.gateway.AiChatRequest;
import com.wotb.ai.gateway.AiRequestContext;
import com.wotb.ai.gateway.AiUpstreamException;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.function.LongSupplier;

@Service
public class TacticalReviewHarness {

    private static final Logger LOGGER = LoggerFactory.getLogger(TacticalReviewHarness.class);

    static final int SAFETY_MARGIN_SEC = 10;
    static final int FALLBACK_MIN_REMAINING_SEC = 60;
    static final int ENDPOINT_DEADLINE_SEC = 1100;

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

    public HarnessOutcome analyzeWithPrior(final Battle battle,
                                           final ReplayReconstruction reconstruction,
                                           final AllowedLanguage language,
                                           final AiReviewStreamListener listener) {
        final long startNanos = budgetStartNanos();
        if (remainingSeconds(startNanos) < SAFETY_MARGIN_SEC) {
            LOGGER.info("Harness overall deadline exhausted before start, aborting with AI_TIMEOUT");
            throw new AiUpstreamException("AI_TIMEOUT", 504, AiRequestContext.correlationId());
        }
        if (language != AllowedLanguage.ZH) {
            return new HarnessOutcome(fallback(battle, reconstruction, language, "NON_ZH", listener), null);
        }
        if (battle == null) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        if (!preBattleService.isConfigured()) {
            return new HarnessOutcome(fallback(battle, reconstruction, language, "AI_NOT_CONFIGURED", listener), null);
        }
        if (reconstruction == null) {
            LOGGER.info("Harness rejecting AI review: NO_RECONSTRUCTION (timeline unusable)");
            throw new AiTimelineUnusableException("NO_RECONSTRUCTION");
        }
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(battle, reconstruction);
        if (!recorder.resolved()) {
            LOGGER.info("Harness rejecting AI review: RECORDER_UNRESOLVED (timeline unusable)");
            throw new AiTimelineUnusableException("RECORDER_UNRESOLVED");
        }
        final BattleTimelineResult timelineResult = BattleTimelineBuilder.build(
                battle, reconstruction,
                TimelinePerspective.personal(recorder.accountId(), recorder.team()));
        if (!timelineResult.usable()) {
            LOGGER.info("Harness rejecting AI review: timeline unusable: {}",
                    timelineResult.validation().errors());
            throw new AiTimelineUnusableException(timelineResult.validation().errors());
        }
        final BattleTimeline timeline = timelineResult.timeline();
        final PlayerBattleFeatureSet features;
        try {
            features = new DefaultPlayerBattleFeatureExtractor().extract(
                    reconstruction, recorder, battle);
        } catch (final RuntimeException e) {
            LOGGER.info("Harness feature extraction failed, falling back: {}", e.getMessage());
            return new HarnessOutcome(fallback(battle, reconstruction, language, "FEATURES_FAILED", listener), null);
        }
        if (!features.hasFeatures()) {
            return new HarnessOutcome(fallback(battle, reconstruction, language, "FEATURES_UNAVAILABLE", listener), null);
        }

        final PreBattleStrategicPrior prior = preBattleService.analyze(battle, listener);
        if (prior == null) {
            if (remainingSeconds(startNanos) < FALLBACK_MIN_REMAINING_SEC) {
                LOGGER.info("Harness prior unavailable and budget insufficient, aborting with AI_TIMEOUT");
                throw new AiUpstreamException(
                        "AI_TIMEOUT", null, AiRequestContext.correlationId());
            }
            return new HarnessOutcome(fallback(battle, reconstruction, language, "PRE_BATTLE_UNAVAILABLE", listener), null);
        }
        LOGGER.info("Harness prior obtained: hypotheses={} matchups={} winConditions={}",
                prior.hypotheses().size(),
                prior.keyMatchups().size(),
                prior.strategicWinConditions().size());

        final EvidenceSkillResult evidence = skillEngine.run(new EvidenceSkillContext(
                battle, reconstruction, features, recorder));
        listener.onStage("evidence_done");
        if (!evidence.hasContent()) {
            return new HarnessOutcome(fallback(battle, reconstruction, language, "NO_EVIDENCE", listener), null);
        }

        final TacticalReviewPromptBuilder.PreparedHarnessPrompt prepared =
                TacticalReviewPromptBuilder.prepare(
                        prior,
                        evidence,
                        battle,
                        reconstruction,
                        timeline,
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
        if (meterRegistry != null && prepared.sectionTokens() != null) {
            prepared.sectionTokens().forEach((section, tokens) ->
                    meterRegistry.counter(
                            "wotb_ai_review_context_section_tokens", "section", section)
                            .increment(tokens));
        }
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

    private AnalyzeResult fallback(final Battle battle,
                                   final ReplayReconstruction reconstruction,
                                   final AllowedLanguage language,
                                   final String reason,
                                   final AiReviewStreamListener listener) {
        LOGGER.info("Harness fell back to old path: {}", reason);
        count(reason);
        return playerService.analyzePlayerOrFallback(battle, reconstruction, language, listener);
    }

    private void count(final String reason) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_harness_total", "result", reason).increment();
        }
    }

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
