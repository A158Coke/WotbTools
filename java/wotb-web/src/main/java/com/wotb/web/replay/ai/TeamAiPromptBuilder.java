package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 将 Team Context 压缩为确定性、长度受限的 AI 输入。
 * 不接收或输出原始 ReplayEvent/逐帧位置流。
 * <p>
 * 使用 AiTokenEstimator 进行 token 预算管理，不再使用固定字符限制或固定数量截断。
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
        final Set<String> limitations = collectLimitations(context, extraLimitations);

        // 先构建 HPF：对方阵容属权威结算且体量很小（≤7 行），与本队事实同为 mandatory，
        // 不能被 optional 预算裁掉。构建结果决定是否需要补 OPPOSING_LINEUP_UNAVAILABLE，
        // 因此必须在 header 写出 unitLimitations 之前完成。
        final TeamEvidenceFormatter.BudgetWriter hpfTemp = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendHighPriorityFacts(
                hpfTemp, context.features(), context.analysisUnitId(), List.copyOf(limitations));
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

        // 构建所有 optional details（无固定截断）
        final TeamEvidenceFormatter.BudgetWriter optTemp = new TeamEvidenceFormatter.BudgetWriter();
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
        // 点数局势（击杀夺分时间线/占领点存在/推进窗口）：同为 optional 证据
        TeamEvidenceFormatter.appendPointsSituation(
                optTemp,
                context.battle(),
                context.reconstruction(),
                context.perspectiveTeam(),
                limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        final String optBlock = optTemp.content();

        // 如果 mandatory（header + HPF + prior）超出 token 预算，直接抛出异常
        if (estimator != null) {
            final String mandatoryContent = headerBlock + priorBlock + hpfBlock;
            if (estimator.estimateTextTokens(mandatoryContent) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
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
