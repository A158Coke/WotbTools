package com.wotb.web.replay.ai;

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
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.ai.gateway.StreamConsumer;
import com.wotb.web.replay.dto.AiReviewDonePayload;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
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

/**
 * 团队 AI 复盘编排（team perspective：训练房/联赛）。
 * <p>职责：{@link #analyzeTeam} 的完整编排（Call #1 prior、逐 context 的 Team Prompt 调用）；
 * roster 校验/Context 组装/团队 Prompt 规则
 * 分别由 {@link TeamRosterResolver} / {@link TeamContextBuilder} /
 * {@link TeamPromptLocalizer} 负责。Prompt 文本由 {@link TeamAiPromptBuilder} 产出，
 * HTTP/DTO/异常分类由 {@link AiChatGateway} 负责，预算由 {@link AiPromptBudgetGuard} 守。</p>
 * <p>团队复盘与随机战一样先执行 Call #1（Pre-Battle Strategic Prior：基于地图与双方阵容的赛前先验，
 * 含开局/分路假设），按视角队伍重标 TEAM_A 后注入团队 Prompt；Call #1 失败不阻断团队复盘（仅缺 prior 段）。
 * Call #2 只接受 Team AI Review 结构化 JSON；后端只做 JSON/schema/引用的技术解析，
 * 不判断战术结论。</p>
 * <p><b>Canonical Timeline hard gate（PR #102 ）</b>：{@link #analyzeTeam}
 * 是 Team AI 的<b>唯一 production 编排入口</b>。
 * 它在<b>任何 LLM 调用之前</b>（Call #1 prior / Call #2）为每个 context 构建并
 * 验证 canonical BattleTimeline（一次 build、一次 validation）：reconstruction 缺失 /
 * timeline 不可用 / timeline 为 null → 立即抛 {@link AiTimelineUnusableException}（AI Gateway
 * requests = 0），禁止 settlement-only fallback；验证通过后同一 validated timeline 下传给
 * {@link TeamAiPromptBuilder} 渲染 TACTICAL TIMELINE 段（绝不在 PromptBuilder 内重复 build）。</p>
 */
@Service
public class TeamReplayAnalysisService {

    private static final Logger LOGGER = LoggerFactory.getLogger(TeamReplayAnalysisService.class);
    /** 团队复盘整体安全余量（秒）：后续调用保留，避免撞 endpoint deadline。 */
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

    /**
     * 单团队 Call #2（Team production v0.5 唯一入口）：请求 JSON_OBJECT，解析并
     * 校验 {@link TeamAiReviewResult}，然后把结构化结果交给 SSE done 事件。
     */
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

    /**
     * Production entry for the standalone service: no processing result or group wrapper.
     * <p>返回 SSE {@code done} 的唯一 transport 形状（{@link AiReviewDonePayload}）。
     * {@code capability} 是 request 级判定（依赖客户端投影声明的 limitations），编排层不可见，
     * 由 controller 在发送前填充，因此这里恒为 {@code null}。</p>
     */
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
        // Canonical Timeline hard gate（PR #102 ）：在任何 LLM 调用（Call #1 /
        // Call #2）之前为每个 context 构建并验证 canonical timeline。
        // reconstruction 缺失 / timeline 不可用 / timeline 为 null → 立即拒绝（AI Gateway
        // requests = 0），禁止 settlement-only fallback；验证通过后同一 timeline 下传给
        // TeamAiPromptBuilder 渲染 TACTICAL TIMELINE（不重复 build）。
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
            // 预算起点回溯到提交时刻（now + overall）：排队计入剩余预算，
            // 启动时剩余不足直接干净失败 AI_TIMEOUT。
            throw new AiUpstreamException("AI_TIMEOUT", 504, AiRequestContext.correlationId());
        }
        final Map<String, PreBattleStrategicPrior> priorsByUnitId = new LinkedHashMap<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            priorsByUnitId.put(ctx.analysisUnitId(), call1Prior(ctx.battle(), listener));
        }
        // 证据分析完成：与随机战 harness 对齐，让前端阶段指示从「证据分析中…」推进到「战术复盘生成中…」
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
                        // display label：无可靠 clan 时为空串 → renderer 只显示「我方画像」
                        TeamRosterResolver.resolveDisplayLabel(firstContext.battle(), firstContext.perspectiveTeam()),
                        language,
                        firstContext.battle() == null ? null : firstContext.battle().mapName);
        return new AiReviewDonePayload(firstAnalysis.analysis().analysis(), preBattleSection, null,
                firstAnalysis.structuredResult(), TeamRosterResolver.playerIdentities(firstContext));
    }

    /**
     * 构建并验证单个 context 的 canonical Team timeline（hard gate，见类 javadoc）。
     * reconstruction 缺失 / build 不可用 / timeline 为 null → 抛
     * {@link AiTimelineUnusableException}（拒绝整个 Team AI Review，AI Gateway requests = 0）。
     */
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

    // ===== 协作入口：Team Prompt 常量 / 本地化 / 单团队 Context 构建（契约测试引用） =====

    static final String SINGLE_TEAM_PROMPT = TeamPromptLocalizer.SINGLE_TEAM_PROMPT;

    static String localizeTeamSystemPrompt(final String zhPrompt, final AllowedLanguage language) {
        return TeamPromptLocalizer.localizeTeamSystemPrompt(zhPrompt, language);
    }

    public SingleTeamBattleAnalysisContext buildSingleTeamContext(final Battle battle,
                                                                  final ReplayReconstruction reconstruction) {
        return TeamContextBuilder.buildSingleTeamContext(battle, reconstruction);
    }

    /** Call #2：严格解析结构化 JSON；技术 contract 失败时最多 fresh retry 一次。 */
    private TeamAiReviewResult callStructuredTeamReview(
            final SingleTeamBattleAnalysisContext context,
            final TeamAiPromptBuilder.PromptInput input,
            final AllowedLanguage language,
            final long startNanos,
            final BattleTimeline timeline
    ) {
        final String systemPrompt = TeamPromptLocalizer.localizeTeamSystemPrompt(
                TeamPromptLocalizer.SINGLE_TEAM_PROMPT, language);
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
        // 只记录低基数 grounding facts 计数（不打印事实内容）。
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
                    PrimaryAttemptMetadata.unavailable(), "EMPTY_RESPONSE");
        }
        final TeamAiReviewResultParser.ParseResult primary = TeamAiReviewResultParser.parse(
                primaryResponse.completionText(), rosterKeys);
        if (primary.usable()) {
            final boolean salvaged = primary.normalized();
            if (salvaged) {
                logContractFailure(correlationId, primary, 1, false);
                logContractSalvage(correlationId, primary);
            }
            countValidationAttempt(salvaged ? "salvaged" : "pass");
            logTeamReviewCompleted(correlationId, 1, primaryResponse.inputTokens(),
                    primaryResponse.outputTokens(), salvaged ? "SALVAGED" : "PASS", reviewStartNanos);
            return primary.result();
        }
        countValidationAttempt("schema_invalid");
        logContractFailure(correlationId, primary, 1, true);
        return recoverTeamReview(baseUser, language, startNanos,
                rosterKeys, correlationId, reviewStartNanos,
                PrimaryAttemptMetadata.from(primaryResponse), recoveryReason(primary));
    }

    private TeamAiReviewResult recoverTeamReview(final String baseUser,
                                                     final AllowedLanguage language,
                                                     final long startNanos,
                                                     final Set<String> rosterKeys,
                                                     final String correlationId,
                                                     final long reviewStartNanos,
                                                     final PrimaryAttemptMetadata primaryAttempt,
                                                     final String reason) {
        logRecoveryTriggered(correlationId, primaryAttempt.responseLength(), reason);
        countRepair("started");
        final String recoveryPrompt = baseUser + "\n\n" + recoveryUserInstruction(language, rosterKeys);
        final AiChatResponse response;
        try {
            response = callRaw(recoverySystemPrompt(language), recoveryPrompt,
                    "SINGLE_TEAM_BATTLE_RECOVERY", remainingBudget(startNanos), 2);
        } catch (final AiUpstreamException e) {
            if (!"AI_EMPTY_RESPONSE".equals(e.code())) {
                throw e;
            }
            logRecoveryFailed(correlationId, "SCHEMA_FAILED");
            countRepair("failed");
            throw new AiUpstreamException("AI_REVIEW_SCHEMA_FAILED", 502, correlationId);
        }
        final TeamAiReviewResultParser.ParseResult recovery = TeamAiReviewResultParser.parse(
                response.completionText(), rosterKeys);
        if (recovery.status() == TeamAiReviewResultParser.ParseStatus.VALID && recovery.usable()) {
            countValidationAttempt("pass");
            countRepair("success");
            logTeamReviewCompleted(correlationId, 2,
                    primaryAttempt.inputTokens() + response.inputTokens(),
                    primaryAttempt.outputTokens() + response.outputTokens(),
                    "RECOVERY_SUCCESS", reviewStartNanos);
            return recovery.result();
        }
        countValidationAttempt("schema_invalid");
        logContractFailure(correlationId, recovery, 2, false);
        logRecoveryFailed(correlationId, "SCHEMA_FAILED");
        countRepair("failed");
        logTeamReviewCompleted(correlationId, 2,
                primaryAttempt.inputTokens() + response.inputTokens(),
                primaryAttempt.outputTokens() + response.outputTokens(),
                "SCHEMA_FAILED", reviewStartNanos);
        throw new AiUpstreamException("AI_REVIEW_SCHEMA_FAILED", 502, correlationId);
    }

    private static String recoverySystemPrompt(final AllowedLanguage language) {
        return TeamPromptLocalizer.localizeTeamSystemPrompt(
                        TeamPromptLocalizer.SINGLE_TEAM_PROMPT, language)
                + switch (language) {
                    case EN -> "\n\nRECOVERY STRICTNESS: output only the canonical v0.5 TeamAiReviewResult object "
                            + "described above. Root and nested objects reject extra fields; never emit unknown_field, "
                            + "repair instructions, schema metadata, or explanatory prose. Use only authoritative roster "
                            + "playerKey values supplied in the user context; omit uncertain optional references.";
                    case RU -> "\n\nСТРОГИЙ RECOVERY-КОНТРАКТ: выводите только описанный выше канонический "
                            + "объект TeamAiReviewResult v0.5. Дополнительные поля в root и вложенных объектах запрещены; "
                            + "не выводите unknown_field, инструкции repair, метаданные schema или поясняющий текст. "
                            + "Используйте только authoritative roster playerKey из контекста; сомнительные optional references опускайте.";
                    case ZH -> "\n\nRECOVERY 严格约束：只输出上方 canonical v0.5 TeamAiReviewResult object。"
                            + "root 与所有 nested object 都拒绝额外字段；禁止输出 unknown_field、repair instructions、schema metadata 或解释性文本。"
                            + "playerKey 只能使用 user context 提供的 authoritative roster key；无法确认的 optional reference 直接省略。";
                };
    }

    private static String recoveryUserInstruction(final AllowedLanguage language,
                                                   final Set<String> rosterKeys) {
        final String roster = rosterKeys.stream().sorted().collect(java.util.stream.Collectors.joining(", "));
        return switch (language) {
            case EN -> "=== RECOVERY REQUEST ===\n"
                    + "This is the only recovery attempt. Regenerate the complete team review from the same battle context. "
                    + "Reuse the TeamAiReviewResult v0.5 contract from the system message strictly: root and nested objects "
                    + "must not contain extra fields; never emit unknown_field, repair instructions, or schema/error metadata. "
                    + "Output only the final JSON object, with no Markdown fence, explanation, or commentary outside JSON. "
                    + "playerKey values must be copied verbatim from the authoritative roster key set; omit uncertain optional "
                    + "references and never guess or invent playerKey. authoritative roster key set=[" + roster + "]. "
                    + "Keep the same tactical task and authoritative battle context; do not invent new facts.";
            case RU -> "=== RECOVERY REQUEST ===\n"
                    + "Это единственная попытка recovery. Повторно сформируйте полный командный разбор на основе того же контекста боя. "
                    + "Строго используйте контракт TeamAiReviewResult v0.5 из системного сообщения: в root и вложенных объектах "
                    + "запрещены дополнительные поля; не выводите unknown_field, инструкции repair или schema/error metadata. "
                    + "Выводите только итоговый JSON object без Markdown fence, объяснений и комментариев вне JSON. "
                    + "Значения playerKey должны дословно соответствовать authoritative roster key set; сомнительные optional "
                    + "references опускайте и никогда не угадывайте или не изобретайте playerKey. authoritative roster key set=[" + roster + "]. "
                    + "Сохраните ту же тактическую задачу и authoritative battle context; не добавляйте новые факты.";
            case ZH -> "=== RECOVERY REQUEST ===\n"
                    + "这是唯一一次 recovery。请基于同一战局上下文重新生成完整团队复盘。"
                    + "严格复用系统消息中的 TeamAiReviewResult v0.5 contract：root 和 nested object 都禁止 extra field，"
                    + "禁止 unknown_field、repair instructions、schema/error metadata；只输出最终 JSON object，"
                    + "不要输出 Markdown fence、解释或 JSON 外 commentary。"
                    + "playerKey 只能逐字取自 authoritative roster key set；无法确认的 optional reference 直接省略，"
                    + "不得猜测或发明 playerKey。authoritative roster key set=[" + roster + "]."
                    + "保持相同战术任务和权威战局上下文，不要发明新事实。";
        };
    }

    private void logContractFailure(final String correlationId,
                                    final TeamAiReviewResultParser.ParseResult parsed,
                                    final int attempt,
                                    final boolean countAsSchemaFailure) {
        LOGGER.warn(AiReviewEventLog.line("ai_review_contract_failed", correlationId,
                "attempt", attempt,
                "failureCategory", failureCategories(parsed),
                "failureCode", parsed.failure() == null ? "UNKNOWN" : parsed.failure(),
                "failurePath", failurePaths(parsed)));
        if (meterRegistry != null && attempt == 1 && countAsSchemaFailure) {
            parsed.failures().forEach(failure -> meterRegistry.counter(
                    "wotb_ai_team_review_schema_failure_total",
                    "reason", failure.code().name(),
                    "path_class", pathClass(failure.path())).increment());
        }
    }

    private void logContractSalvage(final String correlationId,
                                    final TeamAiReviewResultParser.ParseResult parsed) {
        final String failurePaths = failurePaths(parsed);
        LOGGER.info(AiReviewEventLog.line("ai_review_contract_salvage_started", correlationId,
                "failureCategory", failureCategories(parsed),
                "failureCode", parsed.failure() == null ? "UNKNOWN" : parsed.failure(),
                "failurePath", failurePaths));
        final int removedReferences = (int) parsed.failures().stream()
                .filter(failure -> failure.code() == TeamAiReviewResultParser.Failure.INVALID_REFERENCE)
                .count();
        final int removedEntries = parsed.normalizations().stream()
                .filter(normalization -> normalization.type().endsWith("_item_dropped")
                        || normalization.type().equals("training_suggestion_dropped"))
                .mapToInt(TeamAiReviewResultParser.Normalization::count)
                .sum();
        LOGGER.info(AiReviewEventLog.line("ai_review_contract_salvage_completed", correlationId,
                "failureCategory", failureCategories(parsed),
                "failureCode", parsed.failure() == null ? "UNKNOWN" : parsed.failure(),
                "failurePath", failurePaths,
                "removedReferences", removedReferences,
                "removedEntries", removedEntries,
                "normalizationCount", parsed.normalizations().size(),
                "result", parsed.usable() ? "SUCCESS" : "STILL_INVALID"));
    }

    private static String failurePaths(final TeamAiReviewResultParser.ParseResult parsed) {
        return parsed.failures().stream().map(item -> pathClass(item.path()))
                .distinct().sorted().collect(java.util.stream.Collectors.joining(","));
    }

    private static String failureCategories(final TeamAiReviewResultParser.ParseResult parsed) {
        return parsed.failures().stream().map(TeamAiReviewResultParser.ParseFailure::category)
                .distinct().sorted().map(Enum::name)
                .collect(java.util.stream.Collectors.joining(","));
    }

    private static String recoveryReason(final TeamAiReviewResultParser.ParseResult parsed) {
        if (parsed.fatal()) {
            return switch (parsed.failure()) {
                case TeamAiReviewResultParser.Failure.EMPTY_OUTPUT -> "EMPTY_RESPONSE";
                case TeamAiReviewResultParser.Failure.INVALID_JSON,
                        TeamAiReviewResultParser.Failure.OUTPUT_TOO_LARGE -> "UNPARSEABLE_RESPONSE";
                default -> "UNPARSEABLE_RESPONSE";
            };
        }
        return "MINIMUM_CONTRACT_UNRECOVERABLE";
    }

    private void logRecoveryTriggered(final String correlationId, final int primaryResponseLength,
                                      final String reason) {
        LOGGER.warn(AiReviewEventLog.line("ai_review_recovery_triggered", correlationId,
                "reason", reason, "primaryResponseLength", primaryResponseLength));
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_repair_total", "result", "triggered").increment();
        }
    }

    private void logRecoveryFailed(final String correlationId, final String reason) {
        LOGGER.warn(AiReviewEventLog.line("ai_review_recovery_failed", correlationId,
                "reason", reason));
    }

    private record PrimaryAttemptMetadata(int responseLength, long inputTokens, long outputTokens) {

        private static PrimaryAttemptMetadata unavailable() {
            return new PrimaryAttemptMetadata(0, 0, 0);
        }

        private static PrimaryAttemptMetadata from(final AiChatResponse response) {
            return new PrimaryAttemptMetadata(response.completionText().length(),
                    response.inputTokens(), response.outputTokens());
        }
    }

    private void countRepair(final String result) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_repair_total", "result", result).increment();
        }
    }

    static String pathClass(final String path) {
        if (path == null || path.isBlank()) return "root";
        final String normalized = path.replaceAll("\\[\\d+\\]", "");
        if (normalized.startsWith("root.")) return "root.unknown_field";
        if (normalized.startsWith("summary.")) return "summary.unknown_field";
        if (normalized.startsWith("episodes.")) {
            return switch (normalized) {
                case "episodes.id" -> "episodes.id";
                case "episodes.time" -> "episodes.time";
                case "episodes.playerKeys" -> "episodes.playerKeys";
                default -> "episodes.unknown_field";
            };
        }
        if (normalized.startsWith("trainingSuggestions.")) {
            return normalized.equals("trainingSuggestions.episodeId")
                    ? "trainingSuggestions.episodeId" : "trainingSuggestions.unknown_field";
        }
        if (normalized.startsWith("reviewFocus.")) {
            return switch (normalized) {
                case "reviewFocus.playerKey" -> "reviewFocus.playerKey";
                case "reviewFocus.episodeId" -> "reviewFocus.episodeId";
                default -> "reviewFocus.unknown_field";
            };
        }
        if (normalized.startsWith("highContributors.")) {
            return switch (normalized) {
                case "highContributors.playerKey" -> "highContributors.playerKey";
                case "highContributors.episodeId" -> "highContributors.episodeId";
                default -> "highContributors.unknown_field";
            };
        }
        return switch (normalized) {
            case "episodes", "trainingSuggestions", "reviewFocus", "highContributors" -> normalized;
            default -> "root";
        };
    }

    private record TeamCallResult(AnalyzeResult analysis, TeamAiReviewResult structuredResult) {
    }

    /**
     * 原始传输调用：<b>authoritative response source = {@code completionText()}</b>
     * 。
     * <p>Gateway 契约（{@link AiChatGateway#stream} + {@code SpringAiChatGateway}）：
     * callback 是流式增量（progress），{@code completionText()} 是聚合后的完整响应——
     * 正常结束时 {@code SpringAiChatGateway} 用内部累加的全部 delta 构造返回响应；
     * 失败（timeout / cancel / 上游错误 / 空响应）一律抛 {@link AiUpstreamException}，
     * <b>绝不返回 partial completion</b>。因此这里传 no-op consumer（校验通过前不向用户
     * 暴露草稿 token），只以 {@code completionText()} 作为 structured result parser 输入；
     * 每轮 attempt 都是独立的一次 {@code stream()} 调用，不共享任何 buffer。</p>
     * Team Call #2 独立输出上限保持不变。
     */
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
        // Team Call #2 独立输出上限——effective = min(global, teamReview)，
        // 同时用于 AiPromptBudgetGuard（input + output 预算）与 AiChatRequest；Player Call #2 保持 global。
        final int maxOutput = Math.min(config.maxOutputTokens(), config.teamReviewMaxOutputTokens());
        final int estimatedInputTokens = config.estimator().estimateMessagesTokens(messages);
        AiPromptBudgetGuard.enforce(
                estimatedInputTokens,
                config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(),
                maxOutput,
                config.promptSafetyMarginTokens());
        // 发送前记录 prompt 预算（~234k×3 的 token amplification 必须可观测）。
        LOGGER.info(AiReviewEventLog.line("ai_prompt_budget", AiRequestContext.correlationId(),
                "stage", "TEAM_CALL_2",
                "attempt", attempt,
                "estimatedInputTokens", estimatedInputTokens,
                "maxOutputTokens", maxOutput,
                "contextWindowTokens", config.contextWindowTokens(),
                "remainingBudgetSec", callTimeoutSec));
        // 仅 Team Call #2（SINGLE_TEAM_BATTLE Natural Coach Call #2）
        // 显式使用 JSON_OBJECT；输出格式属于 request contract，不由 analysisMode 隐式推断。
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

    /** no-op consumer：主复盘 token 由 controller 侧 SSE 通道推进，Call #2 只取聚合结果。 */
    private static final StreamConsumer IGNORED_STREAM = delta -> {
    };

    /**
     * 预算起点（nanoTime）：有 worker 整体 deadline（提交时刻 + overall）时
     * 回溯到提交时刻，排队等待计入预算；无 deadline（如直接调用 analyze）时用当前时间。
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

    private long remainingBudget(final long startNanos) {
        return Math.max(0L, remainingSeconds(startNanos) - SAFETY_MARGIN_SEC);
    }

    // ===== AI Review 全链路事件日志与指标 =====

    /** 只记录低基数 grounding facts 计数（不打印事实内容）。 */
    private void logGroundingReady(final TeamGroundingFacts.GroundingFacts facts,
                                   final String correlationId) {
        LOGGER.info(AiReviewEventLog.line("team_review_grounding_ready", correlationId,
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

    /** Team Call #2 阶段汇总（终态以 controller 的 ai_review_finished 为准，exactly once）。 */
    private void logTeamReviewCompleted(final String correlationId,
                                        final int validationAttempts,
                                        final long cumulativePromptTokens,
                                        final long cumulativeCompletionTokens,
                                        final String result,
                                        final long reviewStartNanos) {
        LOGGER.info(AiReviewEventLog.line("team_review_completed", correlationId,
                "validationAttempts", validationAttempts,
                "totalPromptTokens", cumulativePromptTokens,
                "totalCompletionTokens", cumulativeCompletionTokens,
                "durationMs", elapsedMillis(reviewStartNanos),
                "result", result));
    }

    /** Team Call #2 validation attempt 低基数指标（result=pass/salvaged/schema_invalid）。 */
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
