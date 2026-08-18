package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 将 Team Context 压缩为确定性、长度受限的 AI 输入。
 * 不接收或输出原始 ReplayEvent/逐帧位置流。
 * <p>
 * 使用 AiTokenEstimator 进行 token 预算管理，不再使用固定字符限制或固定数量截断。
 * </p>
 * <p><b>Canonical Timeline 契约（PR #102 review）</b>：本类<b>不</b>构建
 * {@link BattleTimeline}——build+validation 的唯一入口在
 * {@link TeamReplayAnalysisService} orchestration 层（任何 LLM 调用之前，一次 build
 * 一次 validation）；本类只做确定性渲染。production Team Call #2 通过带
 * {@code BattleTimeline} 的 {@link #single(SingleTeamBattleAnalysisContext, List,
 * PreBattleStrategicPrior, AiTokenEstimator, int, BattleTimeline)} 重载接收已验证
 * timeline 并注入 TACTICAL TIMELINE 段；无 timeline 的兼容/测试重载不渲染该段。</p>
 */
public final class TeamAiPromptBuilder {

    private TeamAiPromptBuilder() {
    }

    // ===== 包内 forwarder：新逻辑在 TeamEvidenceFormatter（契约测试直接引用） =====

    static String structuredTankFacts(final long tankId) {
        return TeamEvidenceFormatter.structuredTankFacts(tankId);
    }

    static String extraInfoFact(final String extraInfo) {
        return TeamEvidenceFormatter.extraInfoFact(extraInfo);
    }

    // ---- 向后兼容的重载（无 token 估算，适用于测试等） ----

    public static PromptInput single(final SingleTeamBattleAnalysisContext context) {
        return single(context, List.of(), null, null, Integer.MAX_VALUE);
    }

    // ---- 主入口（带 token 预算） ----

    public static PromptInput single(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations,
            final PreBattleStrategicPrior prior,
            final AiTokenEstimator estimator,
            final int maxInputTokens
    ) {
        return single(context, extraLimitations, prior, estimator, maxInputTokens, (String) null);
    }

    /**
     * production Team Call #2 入口：接收 orchestration 层已 build+validate 的 canonical
     * {@link BattleTimeline}（PR #102 review B1）——一次 build、一次 validation 后下传，
     * 本方法只渲染（绝不再次 build / 绝不 catch 后降级）；validated timeline 渲染为空是
     * 编程错误 → fail loud。timeline 为 null 只允许出现在兼容/测试入口（本方法不接收 null
     * 语义：production 必然非 null，若调用方传入 null 等价于无 timeline 段）。
     */
    public static PromptInput single(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations,
            final PreBattleStrategicPrior prior,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final BattleTimeline timeline
    ) {
        return single(context, extraLimitations, prior, estimator, maxInputTokens,
                renderTimelineBlock(timeline, context.perspectiveTeam()));
    }

    private static PromptInput single(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations,
            final PreBattleStrategicPrior prior,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final String timelineBlock
    ) {
        final Set<String> limitations = collectLimitations(context, extraLimitations);

        // 先构建 HPF：对方阵容属权威结算且体量很小（≤7 行），与本队事实同为 mandatory，
        // 不能被 optional 预算裁掉。构建结果决定是否需要补 OPPOSING_LINEUP_UNAVAILABLE，
        // 因此必须在 header 写出 unitLimitations 之前完成。
        final TeamEvidenceFormatter.BudgetWriter hpfTemp = new TeamEvidenceFormatter.BudgetWriter();
        final Map<Long, PlayerResult> playersByAccount = new HashMap<>();
        if (context.battle() != null && context.battle().players != null) {
            for (final PlayerResult p : context.battle().players) {
                if (p != null) {
                    playersByAccount.put(p.accountId, p);
                }
            }
        }
        TeamEvidenceFormatter.appendHighPriorityFacts(
                hpfTemp, context.features(), context.analysisUnitId(), List.copyOf(limitations),
                playersByAccount);
        if (!TeamEvidenceFormatter.appendOpposingTeam(hpfTemp, context.battle(), context.perspectiveTeam())) {
            // prompt 要求逐车分析对方；拿不到对方名册时必须显式告知，避免 AI 跳过或编造
            limitations.add("OPPOSING_LINEUP_UNAVAILABLE");
        }
        final String hpfBlock = hpfTemp.content();
        final String priorBlock = TeamEvidenceFormatter.priorSection(
                prior, context.perspectiveTeam(),
                context.battle() != null
                        ? TeamEvidenceFormatter.resolvePerspectiveLabel(context.battle().players, context.perspectiveTeam())
                        : "");

        // 构建 header
        final StringBuilder headerBuf = new StringBuilder();
        headerBuf.append("=== SINGLE_TEAM_CONTEXT ===\n");
        headerBuf.append("analysisUnitId=").append(TeamEvidenceFormatter.quoteData(context.analysisUnitId())).append("\n");
        headerBuf.append("file=").append(TeamEvidenceFormatter.quoteData(context.fileName())).append("\n");
        headerBuf.append("battleIdentity=").append(TeamEvidenceFormatter.quoteData(context.battleId())).append("\n");
        headerBuf.append("category=").append(context.battleCategory()).append("\n");
        if (context.battle() != null) {
            final String teamLabel = TeamEvidenceFormatter.resolvePerspectiveLabel(
                    context.battle().players, context.perspectiveTeam());
            headerBuf.append("teamLabel=").append(TeamEvidenceFormatter.quoteData(teamLabel)).append("\n");
            headerBuf.append("map=").append(TeamEvidenceFormatter.quoteData(TeamEvidenceFormatter.resolveMapName(context.battle().mapName))).append("\n");
            headerBuf.append("durationSec=").append(TeamEvidenceFormatter.formatNullable(context.battle().durationS)).append("\n");
            final String result = TeamEvidenceFormatter.resolveTeamResult(
                    context.battle(), context.perspectiveTeam(), teamLabel);
            headerBuf.append("result=").append(result).append("\n");
            headerBuf.append("resultSource=").append(TeamEvidenceFormatter.resolveTeamResultSource(
                    context.battle(), context.perspectiveTeam())).append("\n");
        }
        headerBuf.append("unitLimitations=").append(limitations).append("\n");
        final String headerBlock = headerBuf.toString();

        // Canonical Timeline 时间线段（团队视角·双方对称）：由 orchestration 层 build+validate
        // 后传入（timelineBlock 参数），本方法只做确定性渲染/预算裁剪，绝不在此 build。
        String optBlock = buildOptionalBlock(context, limitations, true, timelineBlock);

        // 如果 mandatory（header + HPF + prior）超出 token 预算，直接抛出异常
        if (estimator != null) {
            final String mandatoryContent = headerBlock + priorBlock + hpfBlock;
            if (estimator.estimateTextTokens(mandatoryContent) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
            }
            // 超预算时整个 POINTS_SITUATION 区块移除（不留半截正文再追加 AI_INPUT_TRUNCATED）
            if (estimator.estimateTextTokens(mandatoryContent + optBlock) > maxInputTokens) {
                final String optNoPoints = buildOptionalBlock(context, limitations, false, timelineBlock);
                if (!optNoPoints.equals(optBlock)) {
                    optBlock = optNoPoints;
                }
            }
        }

        // 写入所有内容
        final TeamEvidenceFormatter.BudgetWriter writer = new TeamEvidenceFormatter.BudgetWriter();
        writer.appendRequired(headerBlock);
        writer.appendRequired(priorBlock);
        writer.appendRequiredBlock(hpfBlock);
        writer.append(optBlock);

        return writer.finish(estimator, maxInputTokens,
                Set.of(), Set.of(context.analysisUnitId()), Set.of(), Set.of(),
                Map.of(context.analysisUnitId(), List.copyOf(limitations)));
    }

    /** 构建 optional 证据正文：includePointsSituation=false 时点数局势段整体不输出（预算裁剪用）。 */
    private static String buildOptionalBlock(
            final SingleTeamBattleAnalysisContext context,
            final Set<String> limitations,
            final boolean includePointsSituation,
            final String timelineBlock
    ) {
        final TeamEvidenceFormatter.BudgetWriter optTemp = new TeamEvidenceFormatter.BudgetWriter();
        if (timelineBlock != null && !timelineBlock.isBlank()) {
            optTemp.append(timelineBlock);
        }
        TeamEvidenceFormatter.appendOptionalDetails(optTemp, context.features(), context.analysisUnitId(),
                context.battle() == null ? null : context.battle().mapName,
                context.battle(), context.perspectiveTeam(), List.copyOf(limitations));
        // 敌方最后已知位置（观测子集）：与其它 optional 证据同级，超预算时整体被裁剪
        final String enemyPositions = EnemyLastKnownPositionsSection.renderTeamSection(
                context.reconstruction(), context.battle(), context.perspectiveTeam());
        if (!enemyPositions.isEmpty()) {
            optTemp.append("\n" + enemyPositions);
        }
        // 逐成员掉血窗口（事件流观测子集）：与 OBSERVED 聚合同一覆盖率口径
        TeamEvidenceFormatter.appendMemberDamageReceivedWindows(
                optTemp,
                context.battle(),
                context.features() == null ? List.of() : context.features().members(),
                context.reconstruction(),
                limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        // 点数局势（击杀夺分时间线/占领点存在/推进窗口）：完整区块，超预算时整体移除
        if (includePointsSituation) {
            TeamEvidenceFormatter.appendPointsSituation(
                    optTemp,
                    context.battle(),
                    context.reconstruction(),
                    context.perspectiveTeam(),
                    limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        }
        // 阵型深度（前后排）与实际控制区域（确定性，仅团队路径）：小段，随 optional 预算裁剪
        final String formationDepth = FormationDepthEvidence.renderSection(
                context.battle(),
                context.reconstruction(),
                context.perspectiveTeam(),
                context.battle() == null ? null : context.battle().mapName);
        if (!formationDepth.isEmpty()) {
            optTemp.append(formationDepth);
        // 身后输出/血量优势（吸血/避战候选·确定性）：小段，随 optional 预算裁剪
        final String behindLine = BehindLineHpEvidence.renderTeamSection(
                context.battle(),
                context.reconstruction(),
                context.perspectiveTeam(),
                limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        if (!behindLine.isEmpty()) {
            optTemp.append(behindLine);
        }
        }
        return optTemp.content();
    }

    /**
     * 渲染已验证 canonical timeline 的 TACTICAL TIMELINE 段（确定性；只渲染，不 build、
     * 不 catch、不静默降级）。
     * <p>PR #102 review B1：timeline 由 orchestration 层在 LLM 调用之前构建并验证后传入，
     * 此处只消费；{@code timeline == null}（兼容/测试入口未提供 validated timeline）时不
     * 渲染任何段；非 null 却渲染为空是编程错误 → fail loud，不得降级为「无 timeline 的
     * AI Review」。</p>
     */
    static String renderTimelineBlock(final BattleTimeline timeline, final int perspectiveTeam) {
        if (timeline == null) {
            return "";
        }
        final String section = TeamAiContextCompiler.renderTimelineSection(timeline, perspectiveTeam);
        if (section.isBlank()) {
            throw new IllegalStateException(
                    "validated team timeline rendered blank TACTICAL TIMELINE: map=" + timeline.mapCode());
        }
        return "\n=== TACTICAL TIMELINE（时间有序战局章节·battle-relative 确定性） ===\n" + section;
    }

    private static Set<String> collectLimitations(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations
    ) {
        final Set<String> limitations = new LinkedHashSet<>(context.limitations());
        if (context.features() != null) {
            limitations.addAll(context.features().limitations());
        }
        limitations.addAll(extraLimitations);
        return limitations;
    }

    public record PromptInput(
            String content,
            Set<String> includedUnitIds,
            Set<String> omittedUnitIds,
            Set<String> truncatedUnitIds,
            Map<String, List<String>> perUnitLimitations,
            List<String> globalLimitations
    ) {

        public PromptInput {
            includedUnitIds = includedUnitIds == null ? Set.of() : Set.copyOf(includedUnitIds);
            omittedUnitIds = omittedUnitIds == null ? Set.of() : Set.copyOf(omittedUnitIds);
            truncatedUnitIds = truncatedUnitIds == null ? Set.of() : Set.copyOf(truncatedUnitIds);
            perUnitLimitations = perUnitLimitations == null ? Map.of() : Map.copyOf(perUnitLimitations);
            globalLimitations = globalLimitations == null ? List.of() : List.copyOf(globalLimitations);
        }
    }

}
