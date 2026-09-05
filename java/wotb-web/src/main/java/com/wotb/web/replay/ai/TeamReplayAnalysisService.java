package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.evidence.TeamFactualConsistencyValidator;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.evidence.TeamReviewEnvelope;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
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
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

/**
 * 团队 AI 复盘编排（team perspective：训练房/联赛）。
 * <p>职责：兼容 facade 路径的单团队入口、{@code analyzeTeamGroups} 的完整编排（Call #1 prior、
 * 逐 context 的 Team Prompt 调用与 Team Autopsy 追加）；roster 校验/Context 组装/团队 Prompt 规则
 * 分别由 {@link TeamRosterResolver} / {@link TeamContextBuilder} /
 * {@link TeamPromptLocalizer} 负责。Prompt 文本由 {@link TeamAiPromptBuilder} 产出，
 * HTTP/DTO/异常分类由 {@link AiChatGateway} 负责，预算由 {@link AiPromptBudgetGuard} 守，
 * {@code analysisUnitId} 由 {@link AnalysisUnitAssembler} 提供稳定实现。</p>
 * <p>团队复盘与随机战一样先执行 Call #1（Pre-Battle Strategic Prior：基于地图与双方阵容的赛前先验，
 * 含开局/分路假设），按视角队伍重标 TEAM_A 后注入团队 Prompt；Call #1 失败不阻断团队复盘（仅缺 prior 段）。
 * 单团队单元后追加 Team Autopsy（判负战犯 / 判胜 MVP）——这是<b>结算级</b>独立 TEAM_AUTOPSY
 * 调用：Autopsy 输入只有权威逐人结算（无 Call #1 prior / Critical Window / Route 证据），相关结论置信度
 * PARTIAL/UNKNOWN。随机战斗个人复盘不输出战犯/MVP。</p>
 * <p><b>Canonical Timeline hard gate（PR #102 ）</b>：{@code analyzeTeamGroups}
 * 是 Team AI 的<b>唯一 production 编排入口</b>（由 {@code AiReplayReviewService} 调用）。
 * 它在<b>任何 LLM 调用之前</b>（Call #1 prior / Call #2 / Team Autopsy）为每个 context 构建并
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
    private final TeamAutopsyService teamAutopsyService;
    private final LongSupplier nanoTimeSource;
    private final MeterRegistry meterRegistry;

    @Autowired
    public TeamReplayAnalysisService(final AiChatGateway gateway,
                                     final AiReplayAnalysisConfig config,
                                     final PreBattleStrategicService preBattleService,
                                     final TeamAutopsyService teamAutopsyService,
                                     @Autowired(required = false) final MeterRegistry meterRegistry) {
        this(gateway, config, preBattleService, teamAutopsyService, System::nanoTime, meterRegistry);
    }

    TeamReplayAnalysisService(final AiChatGateway gateway,
                              final AiReplayAnalysisConfig config,
                              final PreBattleStrategicService preBattleService,
                              final TeamAutopsyService teamAutopsyService,
                              final LongSupplier nanoTimeSource,
                              final MeterRegistry meterRegistry) {
        this.gateway = gateway;
        this.config = config;
        this.preBattleService = preBattleService;
        this.teamAutopsyService = teamAutopsyService;
        this.nanoTimeSource = nanoTimeSource;
        this.meterRegistry = meterRegistry;
    }

    public boolean isConfigured() {
        return gateway.isConfigured();
    }

    /**
     * 单场团队上下文入口（<b>非 production AI Review entrypoint</b>：仅供兼容 facade /
     * 历史契约测试引用；production Team AI 必须走 {@link #analyzeTeamGroups}，后者在
     * 任何 LLM 调用前执行 canonical Timeline hard gate）。
     * <p>本入口保持旧语义（Call #1 → prompt 构建 → Call #2 + Autopsy），不执行 timeline
     * hard gate，也不渲染 TACTICAL TIMELINE 段（未提供 validated timeline）；不得被
     * production 编排引用（否则构成 hard-gate bypass，见 PR #102 ）。</p>
     */
    public AnalyzeResult analyzeSingleTeamContext(final SingleTeamBattleAnalysisContext context) {
        return analyzeSingleTeamContext(context, AllowedLanguage.ZH);
    }

    public AnalyzeResult analyzeSingleTeamContext(final SingleTeamBattleAnalysisContext context,
                                                  final AllowedLanguage language) {
        return analyzeSingleTeamContext(context, language, AiReviewStreamListener.NOOP);
    }

    public AnalyzeResult analyzeSingleTeamContext(final SingleTeamBattleAnalysisContext context,
                                                  final AllowedLanguage language,
                                                  final AiReviewStreamListener listener) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }
        final long startNanos = budgetStartNanos();
        if (remainingBudget(startNanos) <= 0) {
            // 预算起点回溯到提交时刻（now + overall）：排队计入剩余预算，
            // 启动时剩余不足直接干净失败 AI_TIMEOUT。
            throw new AiUpstreamException("AI_TIMEOUT", 504, AiRequestContext.correlationId());
        }
        final PreBattleStrategicPrior prior = call1Prior(context.battle(), listener);
        final TeamRosterResolver.RosterEvidence evidence = TeamRosterResolver.RosterEvidence.from(context);
        final List<String> extraLimitations = evidence != null ? evidence.limitations() : List.of();
        final TeamAiPromptBuilder.PromptInput input = TeamAiPromptBuilder.single(
                context, extraLimitations, prior, config.estimator(), config.singleReplayMaxInputTokens());
        // 兼容入口无已验证 timeline：Grounding Facts 只含结算可推导事实（该稳定模块不动）。
        return callSingleTeamContext(context, input, language, startNanos, listener, null);
    }

    /**
     * 单团队 Call #2（Team Call #2 唯一入口）：envelope 解析 + 事实一致性校验 + LLM 自修循环。
     * <p>{@code timeline} 为已验证 canonical timeline（production 路径必传；兼容/测试入口传 null，
     * 此时 Grounding Facts 只含结算可推导事实，位置/窗口类校验自动 no-op）。校验通过后
     * 只把 {@code reviewMarkdown} 流式转给前端；校验失败由 LLM 自行改写，Backend 绝不代改句子。</p>
     */
    private AnalyzeResult callSingleTeamContext(
            final SingleTeamBattleAnalysisContext context,
            final TeamAiPromptBuilder.PromptInput input,
            final AllowedLanguage language,
            final long startNanos,
            final AiReviewStreamListener listener,
            final BattleTimeline timeline
    ) {
        final String content = callValidatedTeamReview(context, input, language, startNanos, listener, timeline);
        return new AnalyzeResult(appendTeamAutopsy(context, content, language, startNanos, listener));
    }

    /**
     * 完整 Team 分析编排：逐个 context 发起单队 AI 请求（AI 复盘单文件策略下无分区合并）。
     * <p>返回的 {@link TeamAnalyzeResult#analysis} 是第一个 context 的 AI 输出；
     * {@link TeamAnalyzeResult#preBattleSection} 是对应同一 context 的 Call #1 prior
     * 用户可见渲染（失败/降级为 null）。</p>
     */
    public TeamAnalyzeResult analyzeTeamGroups(final List<ReplayPerspectiveGroup> groups) {
        return analyzeTeamGroups(groups, AllowedLanguage.ZH);
    }

    public TeamAnalyzeResult analyzeTeamGroups(final List<ReplayPerspectiveGroup> groups,
                                               final AllowedLanguage language) {
        return analyzeTeamGroups(groups, language, AiReviewStreamListener.NOOP);
    }

    public TeamAnalyzeResult analyzeTeamGroups(final List<ReplayPerspectiveGroup> groups,
                                               final AllowedLanguage language,
                                               final AiReviewStreamListener listener) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }
        if (groups == null || groups.isEmpty()) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        final List<SingleTeamBattleAnalysisContext> contexts = groups.stream()
                .map(this::buildSingleTeamContext)
                .toList();
        final Set<String> unitIds = new HashSet<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            if (!unitIds.add(ctx.analysisUnitId())) {
                throw new IllegalArgumentException("Duplicate analysisUnitId: " + ctx.analysisUnitId());
            }
        }
        // Canonical Timeline hard gate（PR #102 ）：在任何 LLM 调用（Call #1 /
        // Call #2 / Team Autopsy）之前为每个 context 构建并验证 canonical timeline。
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
        AnalyzeResult firstAnalysis = null;
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
            final AnalyzeResult result = callSingleTeamContext(
                    ctx, input, language, startNanos, listener,
                    timelinesByUnitId.get(ctx.analysisUnitId()));
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
        return new TeamAnalyzeResult(firstAnalysis, preBattleSection);
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

    // ===== 拆分后的协作入口：以下 forwarder 供 facade 与契约测试引用 =====

    static final String SINGLE_TEAM_PROMPT = TeamPromptLocalizer.SINGLE_TEAM_PROMPT;

    static String localizeTeamSystemPrompt(final String zhPrompt, final AllowedLanguage language) {
        return TeamPromptLocalizer.localizeTeamSystemPrompt(zhPrompt, language);
    }

    public SingleTeamBattleAnalysisContext buildSingleTeamContext(final ReplayPerspectiveGroup group) {
        return TeamContextBuilder.buildSingleTeamContext(group);
    }

    /** Team Call #2 事实一致性校验的最大尝试次数（draft → targeted rewrite → full rewrite → fail-safe）。 */
    static final int MAX_VALIDATION_ATTEMPTS = 3;

    /**
     * Team Call #2 编排（Natural Coach 轮）：envelope 解析 + 事实一致性校验 + LLM 自修循环。
     * <p>流程（Draft → validate；FAIL → targeted rewrite；
     * FAIL → full rewrite；仍 FAIL → fail-safe（{@code AI_REVIEW_GROUNDING_FAILED}）。
     * Backend 绝不代改句子；校验通过后才把 {@code reviewMarkdown} 以 token 增量转给前端
     * （避免把待改写的草稿暴露给用户）。</p>
     */
    private String callValidatedTeamReview(
            final SingleTeamBattleAnalysisContext context,
            final TeamAiPromptBuilder.PromptInput input,
            final AllowedLanguage language,
            final long startNanos,
            final AiReviewStreamListener listener,
            final BattleTimeline timeline
    ) {
        final String systemPrompt = TeamPromptLocalizer.localizeTeamSystemPrompt(
                TeamPromptLocalizer.SINGLE_TEAM_PROMPT, language);
        // 死亡时刻时钟契约——production（timeline 非 null）用 timeline 全量构建
        // （关注窗口/位置快照/敌方位置知识）并转 battle-relative；兼容入口（timeline 为 null）
        // 用 reconstruction 的 battleStartRawClockSec 转 battle-relative，避免结算 deathTimeMillis
        // （原始时钟域）以原始值进入 Grounding Facts。
        final TeamGroundingFacts.GroundingFacts facts = timeline != null
                ? TeamGroundingFacts.build(context.battle(), timeline, context.perspectiveTeam())
                : TeamGroundingFacts.build(context.battle(),
                        context.reconstruction() == null
                                || context.reconstruction().battleStartRawClockSec() == null
                                ? null
                                : context.reconstruction().battleStartRawClockSec().doubleValue(),
                        context.perspectiveTeam());
        final String correlationId = AiRequestContext.correlationId();
        final long reviewStartNanos = nanoTimeSource.getAsLong();
        // 只记录低基数 grounding facts 计数（不打印事实内容）。
        logGroundingReady(facts, correlationId);
        final String groundingSection = TeamGroundingFacts.renderGroundingSection(facts);
        final String baseUser = input.content()
                + (groundingSection.isEmpty() ? "" : "\n" + groundingSection);
        String userContent = baseUser;
        String feedback = "";
        boolean fullRewrite = false;
        long cumulativePromptTokens = 0L;
        long cumulativeCompletionTokens = 0L;
        for (int attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
            if (attempt > 1) {
                final StringBuilder fb = new StringBuilder();
                fb.append("上一轮输出未通过事实一致性校验。请修改后重新输出完整的 JSON envelope；")
                        .append("不要改变你的主判断（除非事实不允许），只修正与 GROUNDING FACTS 冲突的表述。\n");
                fb.append(feedback);
                if (fullRewrite) {
                    fb.append("\n要求：请整体重写完整的 JSON envelope（不是局部修补）；"
                            + "每条数值/时间/位置/玩家事件表述都必须与 GROUNDING FACTS 一致，"
                            + "无法满足时降级为「更可能/从交换结果看」级别的表达或删除该句。");
                }
                userContent = baseUser + "\n\n=== 事实一致性校验反馈 ===\n" + fb;
            }
            final AiChatResponse response = callRaw(systemPrompt, userContent,
                    "SINGLE_TEAM_BATTLE", remainingBudget(startNanos), attempt);
            final String raw = response.completionText();
            cumulativePromptTokens += response.inputTokens();
            cumulativeCompletionTokens += response.outputTokens();
            // 每个 validation attempt 完成后记录累计 token（先记录每次调用，不重构 Gateway 聚合）。
            LOGGER.info(AiReviewEventLog.line("team_review_validation_attempt_completed", correlationId,
                    "attempt", attempt,
                    "promptTokens", response.inputTokens(),
                    "completionTokens", response.outputTokens(),
                    "cumulativePromptTokens", cumulativePromptTokens,
                    "cumulativeCompletionTokens", cumulativeCompletionTokens));
            final TeamReviewEnvelopeParser.ParseResult parseResult =
                    TeamReviewEnvelopeParser.parseDetailed(raw);
            if (parseResult.failed()) {
                LOGGER.info(AiReviewEventLog.line("team_review_parse_result", correlationId,
                        "attempt", attempt,
                        "responseFormat", AiResponseFormat.JSON_OBJECT,
                        "result", "FAIL",
                        "reason", parseResult.failureReason()));
                countValidationAttempt("parser_invalid");
                // envelope / structured claims schema 违反（fail-close）——
                // 给 LLM 明确 schema 提示，让它自修，而非静默降级为 text-only
                feedback = "输出不是合法 JSON envelope 或 claims 违反 machine schema："
                        + "必须包含 primaryDiagnosis（title + reasoning 非空）与 reviewMarkdown；"
                        + "每条 claim 必须携带合法 claimType（DEATH / ALIVE_TRANSITION / "
                        + "POSITION_REGION / ENEMY_POSITION / TACTICAL）及对应机器字段："
                        + "DEATH=subject+timeSec(数字)+evidenceIds；"
                        + "ALIVE_TRANSITION=value(机器格式 7v7 -> 4v6)+evidenceIds；"
                        + "POSITION_REGION=timeSec+region(1-9)+count(数字)+side(FRIENDLY/ENEMY)"
                        + "+countSemantics(EXACT/AT_LEAST/SUBSET)+evidenceIds；"
                        + "ENEMY_POSITION=subject(+可选subjectAccountId账号ID稳定身份)+timeSec+region"
                        + "+knowledge(CURRENT/LAST_KNOWN)+evidenceIds；"
                        + "TACTICAL 无机器字段要求；机器字段类型必须正确（数字字段不能用字符串），"
                        + "禁止 LOS/SPOTTING/VISION/LINE_OF_SIGHT claimType。"
                        + "evidenceIds 必须引用真正支撑该 claim 的证据（类型/身份/时间/数值/区域/knowledge 一致），"
                        + "不能借用无关编号。";
                fullRewrite = attempt >= 2;
                continue;
            }
            LOGGER.info(AiReviewEventLog.line("team_review_parse_result", correlationId,
                    "attempt", attempt,
                    "responseFormat", AiResponseFormat.JSON_OBJECT,
                    "result", "PASS"));
            final TeamReviewEnvelope envelope = parseResult.envelope();
            final long validationStartNanos = nanoTimeSource.getAsLong();
            final List<TeamFactualConsistencyValidator.FactConflict> conflicts =
                    TeamFactualConsistencyValidator.validate(envelope, facts);
            if (conflicts.isEmpty()) {
                LOGGER.info(AiReviewEventLog.line("team_review_validation", correlationId,
                        "attempt", attempt,
                        "result", "PASS",
                        "conflictCount", 0,
                        "durationMs", elapsedMillis(validationStartNanos)));
                countValidationAttempt("pass");
                logTeamReviewCompleted(correlationId, attempt, cumulativePromptTokens,
                        cumulativeCompletionTokens, "PASS", reviewStartNanos);
                forwardTokens(listener, envelope.reviewMarkdown());
                return envelope.reviewMarkdown();
            }
            final String checks = conflicts.stream()
                    .map(TeamFactualConsistencyValidator.FactConflict::checkId)
                    .distinct().sorted()
                    .collect(java.util.stream.Collectors.joining(","));
            final boolean hardConflicts =
                    TeamFactualConsistencyValidator.hasHardConflict(conflicts);
            LOGGER.info(AiReviewEventLog.line("team_review_validation", correlationId,
                    "attempt", attempt,
                    "result", hardConflicts ? "FAIL" : "PASS_METADATA",
                    "conflictCount", conflicts.size(),
                    "hardConflictCount", hardConflicts
                            ? (int) conflicts.stream()
                                    .filter(c -> c.severity() == TeamFactualConsistencyValidator.Severity.HARD_FACT)
                                    .count()
                            : 0,
                    "checks", checks,
                    "durationMs", elapsedMillis(validationStartNanos)));
            countValidationAttempt(hardConflicts ? "validation_failed" : "metadata_only_pass");
            // INFO 级安全化冲突明细：生产默认级别必须能定位 grounding failure；只记录
            // check/reasonCode 低基数分类，不记录完整冲突 message / AI 原句 / Grounding Fact 内容。
            for (final TeamFactualConsistencyValidator.FactConflict c : conflicts) {
                LOGGER.info(AiReviewEventLog.line("team_review_validation_conflict", correlationId,
                        "attempt", attempt,
                        "check", c.checkId(),
                        "reasonCode", c.reasonCode() == null ? "UNCLASSIFIED" : c.reasonCode(),
                        "severity", c.severity().name()));
            }
            // P0-14：conflict 低基数指标（每类冲突累计，供 availability dashboard）。
            for (final TeamFactualConsistencyValidator.FactConflict c : conflicts) {
                countGroundingConflict(c.checkId(),
                        c.severity() == TeamFactualConsistencyValidator.Severity.HARD_FACT
                                ? "HARD" : "METADATA");
            }
            // P0-2/P0-6：structured metadata 冲突（evidence binding 类型/时间细节、coverage 缺失、
            // 非关键 machine 字段）不阻塞输出——正文事实正确时直接放行，不浪费 LLM retry
            // （生产已证明 3 次 140k prompt 全量重写导致 AI Review 连续不可用）。只有 HARD_FACT
            // 冲突（用户可见事实错误）才进入 targeted rewrite → full rewrite → fail-safe。
            if (!hardConflicts) {
                LOGGER.info(AiReviewEventLog.line("team_review_metadata_passed", correlationId,
                        "attempt", attempt,
                        "conflictCount", conflicts.size(),
                        "checks", checks));
                logTeamReviewCompleted(correlationId, attempt, cumulativePromptTokens,
                        cumulativeCompletionTokens, "PASS_METADATA", reviewStartNanos);
                forwardTokens(listener, envelope.reviewMarkdown());
                return envelope.reviewMarkdown();
            }
            if (attempt >= MAX_VALIDATION_ATTEMPTS) {
                LOGGER.warn("Team Call #2 grounding validation exhausted after {} attempts ({} conflicts)",
                        MAX_VALIDATION_ATTEMPTS, conflicts.size());
                logTeamReviewCompleted(correlationId, attempt, cumulativePromptTokens,
                        cumulativeCompletionTokens, "GROUNDING_FAILED", reviewStartNanos);
                throw new AiUpstreamException("AI_REVIEW_GROUNDING_FAILED", 502, correlationId);
            }
            // validation retry（业务返工）与 transport retry（网关退避）区分记录。
            final String rewrite = attempt + 1 >= 3 ? "FULL" : "TARGETED";
            LOGGER.warn(AiReviewEventLog.line("ai_validation_retry", correlationId,
                    "stage", "TEAM_CALL_2",
                    "validationAttempt", attempt + 1,
                    "rewrite", rewrite,
                    "reason", "VALIDATION_FAILED"));
            countValidationRetry("TEAM_CALL_2", rewrite);
            feedback = formatConflicts(conflicts);
            fullRewrite = attempt >= 2;
        }
        throw new AiUpstreamException("AI_REVIEW_GROUNDING_FAILED", 502, correlationId);
    }

    private static String formatConflicts(
            final List<TeamFactualConsistencyValidator.FactConflict> conflicts) {
        final StringBuilder sb = new StringBuilder();
        for (final TeamFactualConsistencyValidator.FactConflict c : conflicts) {
            sb.append('[').append(c.checkId()).append("] ").append(c.message()).append('\n');
        }
        return sb.toString();
    }

    /** 把reviewMarkdown 按段落/句子边界切成 ≤400 字符增量转给前端（单线程顺序）。 */
    private static void forwardTokens(final AiReviewStreamListener listener, final String markdown) {
        if (listener == null || markdown == null || markdown.isEmpty()) {
            return;
        }
        final List<String> chunks = new ArrayList<>();
        final StringBuilder cur = new StringBuilder();
        for (int i = 0; i < markdown.length(); i++) {
            cur.append(markdown.charAt(i));
            final char ch = markdown.charAt(i);
            final boolean boundary = ch == '\n' || ch == '。';
            if ((boundary && cur.length() >= 60) || cur.length() >= 400) {
                chunks.add(cur.toString());
                cur.setLength(0);
            }
        }
        if (!cur.isEmpty()) {
            chunks.add(cur.toString());
        }
        for (final String chunk : chunks) {
            listener.onToken(chunk);
        }
    }

    /**
     * 原始传输调用：<b>authoritative response source = {@code completionText()}</b>
     * 。
     * <p>Gateway 契约（{@link AiChatGateway#stream} + {@code SpringAiChatGateway}）：
     * callback 是流式增量（progress），{@code completionText()} 是聚合后的完整响应——
     * 正常结束时 {@code SpringAiChatGateway} 用内部累加的全部 delta 构造返回响应；
     * 失败（timeout / cancel / 上游错误 / 空响应）一律抛 {@link AiUpstreamException}，
     * <b>绝不返回 partial completion</b>。因此这里传 no-op consumer（校验通过前不向用户
     * 暴露草稿 token），只以 {@code completionText()} 作为 envelope parser 输入；
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

    /** no-op consumer：draft token 不转发给用户（校验通过后由 {@link #forwardTokens} 转发）。 */
    private static final StreamConsumer IGNORED_STREAM = delta -> {
    };


    private String appendTeamAutopsy(final SingleTeamBattleAnalysisContext context,
                                     final String reviewText,
                                     final AllowedLanguage language,
                                     final long startNanos,
                                     final AiReviewStreamListener listener) {
        if (language != AllowedLanguage.ZH || context == null || context.battle() == null) {
            return reviewText;
        }
        // 团队赛恒为争霸赛（supremacy）：结算 winnerTeam 缺失时，
        // 一方全灭 → 结算推导；双方均未全灭 → 点数胜利（比较占点得分推断；
        // 结束方式由 pointsEndReason 区分：任一方 ≥1000 提前获胜，均 <1000 为时间耗尽）。
        final TeamBattleWinner winner = FriendlyEnemyResult.resolveTeamBattle(
                context.battle(), context.perspectiveTeam());
        if (!winner.resolved()) {
            return reviewText;
        }
        final long remaining = remainingSeconds(startNanos);
        final long autopsyBudget = Math.min(
                TeamAutopsyService.AUTOPSY_CALL_TIMEOUT_SEC,
                remaining - SAFETY_MARGIN_SEC);
        if (autopsyBudget <= 0) {
            count("budget_exhausted");
            return reviewText;
        }
        // display label（无可靠 clan → 空串）：Autopsy 渲染侧 fallback「本方」，绝不出现 队伍-XXXX
        final String teamLabel = TeamRosterResolver.resolveDisplayLabel(
                context.battle(), context.perspectiveTeam());
        final TeamAutopsyOutcome outcome = teamAutopsyService.analyze(
                context.battle(),
                context.reconstruction(),
                hasObservedDamagePartial(context),
                context.perspectiveTeam(),
                AllowedLanguage.ZH,
                winner,
                teamLabel,
                (int) Math.min(autopsyBudget, Integer.MAX_VALUE),
                listener);
        if (outcome == null) {
            return reviewText;
        }
        // renderSection 不再接收胜负/队名参数——Autopsy 不重复胜负，
        // 只渲染「重点复查/高贡献者」两块（无 standout 时为空串）；playerKey 仅作内部 lookup。
        return reviewText + TeamAutopsyPromptBuilder.renderSection(
                outcome.result(), outcome.roster());
    }

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

    private void count(final String reason) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_review_team_autopsy_total", "result", reason)
                    .increment();
        }
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

    /** Team Call #2 validation attempt 低基数指标（result=pass/parser_invalid/validation_failed）。 */
    private void countValidationAttempt(final String result) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_validation_attempt_total", "result", result)
                    .increment();
        }
    }

    /** validation retry 的有限值分布（不携带 request/user 标识）。 */
    private void countValidationRetry(final String stage, final String rewrite) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_validation_retry_total",
                    "stage", stage, "rewrite", rewrite).increment();
        }
    }

    /** grounding conflict 低基数指标（check=稳定 checkId；severity=HARD/metadata）。 */
    private void countGroundingConflict(final String checkId, final String severity) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_grounding_conflict_total",
                    "check", checkId == null ? "UNCLASSIFIED" : checkId,
                    "severity", severity).increment();
        }
    }

    private long elapsedMillis(final long startNanos) {
        return Math.max(0L, (nanoTimeSource.getAsLong() - startNanos) / 1_000_000L);
    }


    /** OBSERVED_DAMAGE_IS_PARTIAL：上下文或特征集任一命中即抑制观测伤害数字（与 Team/Player 一致口径）。 */
    private static boolean hasObservedDamagePartial(final SingleTeamBattleAnalysisContext context) {
        if (context.limitations() != null && context.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL")) {
            return true;
        }
        return context.features() != null && context.features().limitations() != null
                && context.features().limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL");
    }

}
