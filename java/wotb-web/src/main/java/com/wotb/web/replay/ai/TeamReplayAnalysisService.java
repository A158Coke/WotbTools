package com.wotb.web.replay.ai;

import java.util.ArrayList;
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
import com.wotb.core.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.replay.feature.MultiTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;

import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiRequestContext;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.function.LongSupplier;

/**
 * 单/多团队 AI 复盘编排（team perspective：训练房/联赛）。
 * <p>职责：兼容 facade 路径的单团队入口、{@code analyzeTeamGroups} 的完整编排（Call #1 prior、
 * 分区遍历、Team Prompt 调用与 Team Autopsy 追加）；roster 校验/分区/Context 组装/团队 Prompt 规则
 * 分别由 {@link TeamRosterResolver} / {@link TeamPartitionBuilder} / {@link TeamContextBuilder} /
 * {@link TeamPromptLocalizer} 负责。Prompt 文本由 {@link TeamAiPromptBuilder} 产出，
 * HTTP/DTO/异常分类由 {@link AiChatGateway} 负责，预算由 {@link AiPromptBudgetGuard} 守，
 * {@code analysisUnitId} 由 {@link AnalysisUnitAssembler} 提供稳定实现。</p>
 * <p>团队复盘与随机战一样先执行 Call #1（Pre-Battle Strategic Prior：基于地图与双方阵容的赛前先验，
 * 含开局/分路假设），按视角队伍重标 TEAM_A 后注入团队 Prompt；Call #1 失败不阻断团队复盘（仅缺 prior 段）。
 * 单团队单元后追加 Team Autopsy（判负战犯 / 判胜 MVP）——这是<b>结算级</b>独立 TEAM_AUTOPSY
 * 调用：Autopsy 输入只有权威逐人结算（无 Call #1 prior / Critical Window / Route 证据），相关结论置信度
 * PARTIAL/UNKNOWN。随机战斗个人复盘不输出战犯/MVP。</p>
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

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    @Autowired
    public TeamReplayAnalysisService(final AiChatGateway gateway,
                                     final AiReplayAnalysisConfig config,
                                     final PreBattleStrategicService preBattleService,
                                     final TeamAutopsyService teamAutopsyService) {
        this(gateway, config, preBattleService, teamAutopsyService, System::nanoTime);
    }

    TeamReplayAnalysisService(final AiChatGateway gateway,
                              final AiReplayAnalysisConfig config,
                              final PreBattleStrategicService preBattleService,
                              final TeamAutopsyService teamAutopsyService,
                              final LongSupplier nanoTimeSource) {
        this.gateway = gateway;
        this.config = config;
        this.preBattleService = preBattleService;
        this.teamAutopsyService = teamAutopsyService;
        this.nanoTimeSource = nanoTimeSource;
    }

    public boolean isConfigured() {
        return gateway.isConfigured();
    }

    /**
     * 单场团队上下文入口。使用与 orchestrated path (analyzeTeamGroups) 相同的 RosterEvidence contract。
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
            // ?? deadline????? + overall??????????????????????
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

    private AnalyzeResult callMultiTeamContext(
            final TeamAiPromptBuilder.PromptInput input,
            final AllowedLanguage language,
            final long startNanos,
            final AiReviewStreamListener listener
    ) {
        final String content = call(
                TeamPromptLocalizer.localizeTeamSystemPrompt(TeamPromptLocalizer.MULTI_TEAM_PROMPT, language),
                input.content(), "MULTI_TEAM_BATTLE",
                remainingBudget(startNanos), listener);
        return new AnalyzeResult(content);
    }

    /**
     * 完整 Team 分析编排：将 contexts 划分为兼容分区，每个分区发起一次 AI 请求。
     * <p>返回的 {@link TeamAnalyzeResult#analysis} 是第一个分区的 AI 输出
     * （即第一个输入 group 所在分区的分析结果）；{@link TeamAnalyzeResult#preBattleSection}
     * 是对应同一分区的 Call #1 prior 用户可见渲染（失败/降级为 null）。</p>
     * <p>分区归属通过 canonical 排序（{@link #buildPartitions}）确定，以保证
     * 对 permutation 稳定的分区行为：先按 {@code (battleIdentity, analysisUnitId)}
     * 字典序排序，再执行 complete-link 分组。</p>
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
        final Map<String, TeamRosterResolver.RosterEvidence> evidenceByUnitId = new LinkedHashMap<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            evidenceByUnitId.put(ctx.analysisUnitId(), TeamRosterResolver.RosterEvidence.from(ctx));
        }
        final long startNanos = budgetStartNanos();
        if (remainingBudget(startNanos) <= 0) {
            // ?? deadline????? + overall??????????????????????
            throw new AiUpstreamException("AI_TIMEOUT", 504, AiRequestContext.correlationId());
        }
        final Map<String, PreBattleStrategicPrior> priorsByUnitId = new LinkedHashMap<>();
        final Map<String, Integer> perspectiveTeamByUnitId = new LinkedHashMap<>();
        for (final SingleTeamBattleAnalysisContext ctx : contexts) {
            perspectiveTeamByUnitId.put(ctx.analysisUnitId(), ctx.perspectiveTeam());
            priorsByUnitId.put(ctx.analysisUnitId(), call1Prior(ctx.battle(), listener));
        }
        // 证据分析完成：与随机战 harness 对齐，让前端阶段指示从「证据分析中…」推进到「战术复盘生成中…」
        listener.onStage("evidence_done");
        final List<List<SingleTeamBattleAnalysisContext>> partitions =
                TeamPartitionBuilder.buildPartitions(contexts, evidenceByUnitId);
        AnalyzeResult firstAnalysis = null;
        SingleTeamBattleAnalysisContext firstContext = null;
        for (final var partition : partitions) {
            final AnalyzeResult result;
            if (partition.size() == 1) {
                final var ctx = partition.getFirst();
                final TeamRosterResolver.RosterEvidence evidence = evidenceByUnitId.get(ctx.analysisUnitId());
                final TeamAiPromptBuilder.PromptInput input =
                        TeamAiPromptBuilder.single(
                                ctx,
                                TeamRosterResolver.rosterEvidenceLimits(evidence),
                                priorsByUnitId.get(ctx.analysisUnitId()),
                                config.estimator(),
                                config.singleReplayMaxInputTokens());
                result = callSingleTeamContext(ctx, input, language, startNanos, listener);
            } else {
                final MultiTeamBattleAnalysisContext multiContext =
                        TeamContextBuilder.buildMultiTeamContext(partition, evidenceByUnitId);
                final Map<String, List<String>> partitionEvidenceLimits = new LinkedHashMap<>();
                for (final var ctx : partition) {
                    final TeamRosterResolver.RosterEvidence ev = evidenceByUnitId.get(ctx.analysisUnitId());
                    if (ev != null) {
                        partitionEvidenceLimits.put(ctx.analysisUnitId(), TeamRosterResolver.rosterEvidenceLimits(ev));
                    }
                }
                final TeamAiPromptBuilder.PromptInput input =
                        TeamAiPromptBuilder.multi(
                                multiContext,
                                partitionEvidenceLimits,
                                priorsByUnitId,
                                perspectiveTeamByUnitId,
                                config.estimator(),
                                config.singleReplayMaxInputTokens());
                result = callMultiTeamContext(input, language, startNanos, listener);
            }
            if (firstAnalysis == null) {
                firstAnalysis = result;
                firstContext = partition.getFirst();
            }
        }
        if (firstAnalysis == null) {
            throw new IllegalStateException("NO_ANALYSIS_PRODUCED");
        }
        final String preBattleSection = firstContext == null ? null
                : PreBattleSectionRenderer.render(
                        priorsByUnitId.get(firstContext.analysisUnitId()),
                        perspectiveTeamByUnitId.getOrDefault(firstContext.analysisUnitId(), 0),
                        TeamRosterResolver.resolveTeamLabel(firstContext.battle(), firstContext.perspectiveTeam()),
                        language,
                        firstContext.battle() == null ? null : firstContext.battle().mapName);
        return new TeamAnalyzeResult(firstAnalysis, preBattleSection);
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

    static final String MULTI_TEAM_PROMPT = TeamPromptLocalizer.MULTI_TEAM_PROMPT;

    static String localizeTeamSystemPrompt(final String zhPrompt, final AllowedLanguage language) {
        return TeamPromptLocalizer.localizeTeamSystemPrompt(zhPrompt, language);
    }

    public SingleTeamBattleAnalysisContext buildSingleTeamContext(final ReplayPerspectiveGroup group) {
        return TeamContextBuilder.buildSingleTeamContext(group);
    }

    static boolean hasConsistentRoster(final List<TeamBattleAnalysisSummary> summaries) {
        return TeamRosterResolver.hasConsistentRoster(summaries);
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
        AiPromptBudgetGuard.enforce(
                config.estimator().estimateMessagesTokens(messages),
                config.singleReplayMaxInputTokens(),
                config.contextWindowTokens(),
                config.maxOutputTokens(),
                config.promptSafetyMarginTokens());
        final AiChatRequest request = new AiChatRequest(
                systemPrompt,
                userContent,
                config.model(),
                null,
                config.maxOutputTokens(),
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
        // 一方全灭 → 结算推导；双方均未全灭 → 点数胜利（比较占点得分推断）。
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
        final String teamLabel = context.battle().players == null ? null
                : TeamPerspectiveLabelResolver.resolve(context.battle().players.stream()
                        .filter(p -> p.team == context.perspectiveTeam())
                        .toList());
        final TeamAutopsyOutcome outcome = teamAutopsyService.analyze(
                context.battle(),
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
                outcome.result(), winner, outcome.roster(), teamLabel);
    }

    /**
     * ?????nanoTime??worker ???????? deadline ????????
     * ??????????????????/? analyze ?????????
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
}
