package com.wotb.ai.review;

import com.wotb.ai.gateway.AiEventLog;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.evidence.TeamAiReviewResult;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.ai.gateway.AiChatGateway;
import com.wotb.ai.gateway.AiChatRequest;
import com.wotb.ai.gateway.AiChatResponse;
import com.wotb.ai.gateway.AiRequestContext;
import com.wotb.ai.gateway.AiResponseFormat;
import com.wotb.ai.gateway.AiUpstreamException;
import com.wotb.ai.gateway.StreamConsumer;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

@Service
public class TeamReplayAnalysisService {

    private static final Logger LOGGER = LoggerFactory.getLogger(TeamReplayAnalysisService.class);
    static final int SAFETY_MARGIN_SEC = 10;

    private final AiChatGateway gateway;
    private final AiReplayAnalysisConfig config;
    private final PreBattleStrategicService preBattleService;
    private final LongSupplier nanoTimeSource;
    private final MeterRegistry meterRegistry;

    @Autowired
    public TeamReplayAnalysisService(final AiChatGateway gateway,
                                     final AiReplayAnalysisConfig config,
                                     final PreBattleStrategicService preBattleService,
                                     @Autowired(required = false) final MeterRegistry meterRegistry) {
        this(gateway, config, preBattleService, System::nanoTime, meterRegistry);
    }

    TeamReplayAnalysisService(final AiChatGateway gateway,
                              final AiReplayAnalysisConfig config,
                              final PreBattleStrategicService preBattleService,
                              final LongSupplier nanoTimeSource,
                              final MeterRegistry meterRegistry) {
        this.gateway = gateway;
        this.config = config;
        this.preBattleService = preBattleService;
        this.nanoTimeSource = nanoTimeSource;
        this.meterRegistry = meterRegistry;
    }

    public boolean isConfigured() {
        return gateway.isConfigured();
    }

    private TeamCallResult callSingleTeamContext(
            final SingleTeamBattleAnalysisContext context,
            final TeamAiPromptBuilder.PromptInput input,
            final AllowedLanguage language,
            final long startNanos,
            final BattleTimeline timeline
    ) {
        final TeamAiReviewResult result = callStructuredTeamReview(
                context, input, language, startNanos, timeline);
        return new TeamCallResult(new AnalyzeResult(result.summary().verdict()), result);
    }

    public AiReviewDonePayload analyzeTeam(final Battle battle,
                                           final ReplayReconstruction reconstruction,
                                           final AllowedLanguage language,
                                           final AiReviewStreamListener listener) {
        return analyzeTeamContexts(List.of(TeamContextBuilder.buildSingleTeamContext(battle, reconstruction)),
                language, listener);
    }

    private AiReviewDonePayload analyzeTeamContexts(final List<SingleTeamBattleAnalysisContext> contexts,
                                                    final AllowedLanguage language,
                                                    final AiReviewStreamListener listener) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }
        final Set<String> unitIds = new HashSet<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            if (!unitIds.add(ctx.analysisUnitId())) {
                throw new IllegalArgumentException("Duplicate analysisUnitId: " + ctx.analysisUnitId());
            }
        }
        final Map<String, BattleTimeline> timelinesByUnitId = new LinkedHashMap<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            timelinesByUnitId.put(ctx.analysisUnitId(), validatedTeamTimeline(ctx));
        }
        final Map<String, TeamRosterResolver.RosterEvidence> evidenceByUnitId = new LinkedHashMap<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            evidenceByUnitId.put(ctx.analysisUnitId(), TeamRosterResolver.RosterEvidence.from(ctx));
        }
        final long startNanos = budgetStartNanos();
        if (remainingBudget(startNanos) <= 0) {
            throw new AiUpstreamException("AI_TIMEOUT", 504, AiRequestContext.correlationId());
        }
        final Map<String, PreBattleStrategicPrior> priorsByUnitId = new LinkedHashMap<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            priorsByUnitId.put(ctx.analysisUnitId(), call1Prior(ctx.battle(), listener));
        }
        listener.onStage("evidence_done");
        TeamCallResult firstAnalysis = null;
        SingleTeamBattleAnalysisContext firstContext = null;
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            final TeamRosterResolver.RosterEvidence evidence = evidenceByUnitId.get(ctx.analysisUnitId());
            final TeamAiPromptBuilder.PromptInput input =
                    TeamAiPromptBuilder.single(
                            ctx,
                            TeamRosterResolver.rosterEvidenceLimits(evidence),
                            priorsByUnitId.get(ctx.analysisUnitId()),
                            config.estimator(),
                            config.singleReplayMaxInputTokens(),
                            timelinesByUnitId.get(ctx.analysisUnitId()));
            final TeamCallResult result = callSingleTeamContext(
                    ctx, input, language, startNanos, timelinesByUnitId.get(ctx.analysisUnitId()));
            if (firstAnalysis == null) {
                firstAnalysis = result;
                firstContext = ctx;
            }
        }
        if (firstAnalysis == null) {
            throw new IllegalStateException("NO_ANALYSIS_PRODUCED");
        }
        final String preBattleSection = firstContext == null ? null
                : PreBattleSectionRenderer.render(
                        priorsByUnitId.get(firstContext.analysisUnitId()),
                        firstContext.perspectiveTeam(),
                        TeamRosterResolver.resolveDisplayLabel(firstContext.battle(), firstContext.perspectiveTeam()),
                        language,
                        firstContext.battle() == null ? null : firstContext.battle().mapName);
        return new AiReviewDonePayload(firstAnalysis.analysis().analysis(), preBattleSection, null,
                firstAnalysis.structuredResult(), TeamRosterResolver.playerIdentities(firstContext));
    }

    private static BattleTimeline validatedTeamTimeline(final SingleTeamBattleAnalysisContext ctx) {
        if (ctx == null || ctx.battle() == null || ctx.reconstruction() == null) {
            LOGGER.info("Team AI rejecting review: NO_RECONSTRUCTION (timeline unusable)");
            throw new AiTimelineUnusableException("NO_RECONSTRUCTION");
        }
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                ctx.battle(), ctx.reconstruction(),
                TimelinePerspective.team(ctx.perspectiveTeam()));
        if (!result.usable() || result.timeline() == null) {
            LOGGER.info("Team AI rejecting review: timeline unusable: {}",
                    result.validation().errors());
            throw new AiTimelineUnusableException(result.validation().errors());
        }
        return result.timeline();
    }

    private PreBattleStrategicPrior call1Prior(final Battle battle,
                                               final AiReviewStreamListener listener) {
        try {
            return preBattleService.analyze(battle, listener);
        } catch (final RuntimeException e) {
            LOGGER.warn("Team Call #1 failed, continuing without prior: {}", e.getMessage());
            return null;
        }
    }


    static final String SINGLE_TEAM_PROMPT = TeamPromptLocalizer.SINGLE_TEAM_PROMPT;


    public SingleTeamBattleAnalysisContext buildSingleTeamContext(final Battle battle,
                                                                  final ReplayReconstruction reconstruction) {
        return TeamContextBuilder.buildSingleTeamContext(battle, reconstruction);
    }

    private TeamAiReviewResult callStructuredTeamReview(
            final SingleTeamBattleAnalysisContext context,
            final TeamAiPromptBuilder.PromptInput input,
            final AllowedLanguage language,
            final long startNanos,
            final BattleTimeline timeline
    ) {
        final String systemPrompt = TeamPromptLocalizer.systemPrompt(language);
        final TeamGroundingFacts.GroundingFacts facts = timeline != null
                ? TeamGroundingFacts.build(context.battle(), timeline, context.perspectiveTeam())
                : TeamGroundingFacts.build(context.battle(),
                        context.reconstruction() == null || context.reconstruction().battleStartRawClockSec() == null
                                ? null : context.reconstruction().battleStartRawClockSec().doubleValue(),
                        context.perspectiveTeam());
        final String groundingSection = TeamGroundingFacts.renderGroundingSection(facts);
        final String baseUser = input.content()
                + (groundingSection.isEmpty() ? "" : "\n" + groundingSection);
        final Set<String> rosterKeys = TeamRosterResolver.playerKeys(context);
        final String correlationId = AiRequestContext.correlationId();
        final long reviewStartNanos = nanoTimeSource.getAsLong();
        logGroundingReady(facts, correlationId);
        final AiChatResponse primaryResponse;
        try {
            primaryResponse = callRaw(systemPrompt, baseUser,
                    "SINGLE_TEAM_BATTLE", remainingBudget(startNanos), 1);
        } catch (final AiUpstreamException e) {
            if (!"AI_EMPTY_RESPONSE".equals(e.code())) {
                throw e;
            }
            return recoverTeamReview(baseUser, language, startNanos,
                    rosterKeys, correlationId, reviewStartNanos,
                    TeamReviewContractSupport.PrimaryAttemptMetadata.unavailable(), "EMPTY_RESPONSE");
        }
        final TeamAiReviewResultParser.ParseResult primary = TeamAiReviewResultParser.parse(
                primaryResponse.completionText(), rosterKeys);
        if (primary.usable()) {
            final boolean salvaged = primary.normalized();
            if (salvaged) {
                TeamReviewContractSupport.logContractFailure(
                        LOGGER, meterRegistry, correlationId, primary, 1, false);
                TeamReviewContractSupport.logContractSalvage(LOGGER, correlationId, primary);
            }
            countValidationAttempt(salvaged ? "salvaged" : "pass");
            logTeamReviewCompleted(correlationId, 1, primaryResponse.inputTokens(),
                    primaryResponse.outputTokens(), salvaged ? "SALVAGED" : "PASS", reviewStartNanos);
            return primary.result();
        }
        countValidationAttempt("schema_invalid");
        TeamReviewContractSupport.logContractFailure(
                LOGGER, meterRegistry, correlationId, primary, 1, true);
        return recoverTeamReview(baseUser, language, startNanos,
                rosterKeys, correlationId, reviewStartNanos,
                TeamReviewContractSupport.PrimaryAttemptMetadata.from(primaryResponse),
                TeamReviewContractSupport.recoveryReason(primary));
    }

    private TeamAiReviewResult recoverTeamReview(final String baseUser,
                                                  final AllowedLanguage language,
                                                  final long startNanos,
                                                  final Set<String> rosterKeys,
                                                  final String correlationId,
                                                  final long reviewStartNanos,
                                                  final TeamReviewContractSupport.PrimaryAttemptMetadata primaryAttempt,
                                                  final String reason) {
        TeamReviewContractSupport.logRecoveryTriggered(
                LOGGER, meterRegistry, correlationId, primaryAttempt.responseLength(), reason);
        TeamReviewContractSupport.countRepair(meterRegistry, "started");
        final String recoveryPrompt = baseUser + "\n\n"
                + TeamReviewContractSupport.recoveryUserInstruction(language, rosterKeys);
        final AiChatResponse response;
        try {
            response = callRaw(TeamReviewContractSupport.recoverySystemPrompt(language), recoveryPrompt,
                    "SINGLE_TEAM_BATTLE_RECOVERY", remainingBudget(startNanos), 2);
        } catch (final AiUpstreamException e) {
            if (!"AI_EMPTY_RESPONSE".equals(e.code())) {
                throw e;
            }
            TeamReviewContractSupport.logRecoveryFailed(LOGGER, correlationId, "SCHEMA_FAILED");
            TeamReviewContractSupport.countRepair(meterRegistry, "failed");
            throw new AiUpstreamException("AI_REVIEW_SCHEMA_FAILED", 502, correlationId);
        }
        final TeamAiReviewResultParser.ParseResult recovery = TeamAiReviewResultParser.parse(
                response.completionText(), rosterKeys);
        if (recovery.status() == TeamAiReviewResultParser.ParseStatus.VALID && recovery.usable()) {
            countValidationAttempt("pass");
            TeamReviewContractSupport.countRepair(meterRegistry, "success");
            logTeamReviewCompleted(correlationId, 2,
                    primaryAttempt.inputTokens() + response.inputTokens(),
                    primaryAttempt.outputTokens() + response.outputTokens(),
                    "RECOVERY_SUCCESS", reviewStartNanos);
            return recovery.result();
        }
        countValidationAttempt("schema_invalid");
        TeamReviewContractSupport.logContractFailure(
                LOGGER, meterRegistry, correlationId, recovery, 2, false);
        TeamReviewContractSupport.logRecoveryFailed(LOGGER, correlationId, "SCHEMA_FAILED");
        TeamReviewContractSupport.countRepair(meterRegistry, "failed");
        logTeamReviewCompleted(correlationId, 2,
                primaryAttempt.inputTokens() + response.inputTokens(),
                primaryAttempt.outputTokens() + response.outputTokens(),
                "SCHEMA_FAILED", reviewStartNanos);
        throw new AiUpstreamException("AI_REVIEW_SCHEMA_FAILED", 502, correlationId);
    }

    static String pathClass(final String path) {
        return TeamReviewContractSupport.pathClass(path);
    }

    private record TeamCallResult(AnalyzeResult analysis, TeamAiReviewResult structuredResult) {
    }

    private AiChatResponse callRaw(
            final String systemPrompt,
            final String userContent,
            final String analysisMode,
            final long callTimeoutSec,
            final int attempt
    ) {
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", userContent));
        final int maxOutput = Math.min(config.maxOutputTokens(), config.teamReviewMaxOutputTokens());
        final int estimatedInputTokens = config.estimator().estimateMessagesTokens(messages);
        AiPromptBudgetGuard.enforce(
                estimatedInputTokens,
                config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(),
                maxOutput,
                config.promptSafetyMarginTokens());
        LOGGER.info(AiEventLog.line("ai_prompt_budget", AiRequestContext.correlationId(),
                "stage", "TEAM_CALL_2",
                "attempt", attempt,
                "estimatedInputTokens", estimatedInputTokens,
                "maxOutputTokens", maxOutput,
                "contextWindowTokens", config.contextWindowTokens(),
                "remainingBudgetSec", callTimeoutSec));
        final AiChatRequest request = new AiChatRequest(
                systemPrompt,
                userContent,
                config.model(),
                null,
                maxOutput,
                config.call2ThinkingEnabled(),
                config.call2ThinkingEnabled() ? config.reasoningEffort() : null,
                null,
                analysisMode,
                (int) Math.min(Math.max(1L, callTimeoutSec), Integer.MAX_VALUE),
                AiResponseFormat.JSON_OBJECT);
        return gateway.stream(request, IGNORED_STREAM);
    }

    private static final StreamConsumer IGNORED_STREAM = delta -> {
    };

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

    private long remainingBudget(final long startNanos) {
        return Math.max(0L, remainingSeconds(startNanos) - SAFETY_MARGIN_SEC);
    }


    private void logGroundingReady(final TeamGroundingFacts.GroundingFacts facts,
                                   final String correlationId) {
        LOGGER.info(AiEventLog.line("team_review_grounding_ready", correlationId,
                "factsTotal", facts.facts().size(),
                "deathFacts", facts.facts().stream()
                        .filter(TeamGroundingFacts.EvidenceFact::isDeath).count(),
                "aliveTransitions", facts.aliveTransitions().size(),
                "focusWindows", facts.facts().stream()
                        .filter(f -> TeamGroundingFacts.TYPE_FOCUS_WINDOW.equals(f.type())).count(),
                "positionSnapshots", facts.regionSnapshots().size(),
                "enemyPositionFacts", facts.facts().stream()
                        .filter(f -> TeamGroundingFacts.TYPE_ENEMY_POSITION.equals(f.type())).count()));
    }

    private void logTeamReviewCompleted(final String correlationId,
                                        final int validationAttempts,
                                        final long cumulativePromptTokens,
                                        final long cumulativeCompletionTokens,
                                        final String result,
                                        final long reviewStartNanos) {
        LOGGER.info(AiEventLog.line("team_review_completed", correlationId,
                "validationAttempts", validationAttempts,
                "totalPromptTokens", cumulativePromptTokens,
                "totalCompletionTokens", cumulativeCompletionTokens,
                "durationMs", elapsedMillis(reviewStartNanos),
                "result", result));
    }

    private void countValidationAttempt(final String result) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_validation_attempt_total", "result", result)
                    .increment();
        }
    }

    private long elapsedMillis(final long startNanos) {
        return Math.max(0L, (nanoTimeSource.getAsLong() - startNanos) / 1_000_000L);
    }

}
