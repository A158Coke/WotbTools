package com.wotb.web.replay.ai;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.TeamBattleWinner;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;

import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

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
 * <p><b>Canonical Timeline hard gate（PR #102 review B1）</b>：{@code analyzeTeamGroups}
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
     * production 编排引用（否则构成 hard-gate bypass，见 PR #102 review B1）。</p>
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
        return callSingleTeamContext(context, input, language, startNanos, listener);
    }

    private AnalyzeResult callSingleTeamContext(
            final SingleTeamBattleAnalysisContext context,
            final TeamAiPromptBuilder.PromptInput input,
            final AllowedLanguage language,
            final long startNanos,
            final AiReviewStreamListener listener
    ) {
        final String content = call(
                TeamPromptLocalizer.localizeTeamSystemPrompt(TeamPromptLocalizer.SINGLE_TEAM_PROMPT, language),
                input.content(), "SINGLE_TEAM_BATTLE",
                remainingBudget(startNanos), listener);
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
        // Canonical Timeline hard gate（PR #102 review B1）：在任何 LLM 调用（Call #1 /
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
            final AnalyzeResult result = callSingleTeamContext(ctx, input, language, startNanos, listener);
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

    private String call(
            final String systemPrompt,
            final String userContent,
            final String analysisMode,
            final long callTimeoutSec,
            final AiReviewStreamListener listener
    ) {
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", userContent));
        // PR #103 review BLOCKER C：Team Call #2 独立输出上限——effective = min(global, teamReview)，
        // 同时用于 AiPromptBudgetGuard（input + output 预算）与 AiChatRequest；Player Call #2 保持 global。
        final int maxOutput = Math.min(config.maxOutputTokens(), config.teamReviewMaxOutputTokens());
        AiPromptBudgetGuard.enforce(
                config.estimator().estimateMessagesTokens(messages),
                config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(),
                maxOutput,
                config.promptSafetyMarginTokens());
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
                (int) Math.min(Math.max(1L, callTimeoutSec), Integer.MAX_VALUE));
        return gateway.stream(request, listener::onToken).completionText();
    }


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
        return reviewText + TeamAutopsyPromptBuilder.renderSection(
                outcome.result(), winner, outcome.roster(), teamLabel,
                context.battle(), context.perspectiveTeam());
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

    /** OBSERVED_DAMAGE_IS_PARTIAL：上下文或特征集任一命中即抑制观测伤害数字（与 Team/Player 一致口径）。 */
    private static boolean hasObservedDamagePartial(final SingleTeamBattleAnalysisContext context) {
        if (context.limitations() != null && context.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL")) {
            return true;
        }
        return context.features() != null && context.features().limitations() != null
                && context.features().limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL");
    }

}
