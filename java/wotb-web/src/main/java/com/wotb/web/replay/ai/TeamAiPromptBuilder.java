package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.replay.feature.MultiTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamBattleAnalysisSummary;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
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
final class TeamAiPromptBuilder {

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

    static PromptInput single(final SingleTeamBattleAnalysisContext context) {
        return single(context, List.of(), null, null, Integer.MAX_VALUE);
    }

    // ---- 主入口（带 token 预算） ----

    static PromptInput single(
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
        TeamEvidenceFormatter.appendHighPriorityFacts(hpfTemp, context.features(), context.analysisUnitId());
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
        }
        headerBuf.append("unitLimitations=").append(limitations).append("\n");
        final String headerBlock = headerBuf.toString();

        // 构建所有 optional details（无固定截断）
        final TeamEvidenceFormatter.BudgetWriter optTemp = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendOptionalDetails(optTemp, context.features(), context.analysisUnitId(),
                context.battle() == null ? null : context.battle().mapName,
                context.battle(), context.perspectiveTeam());
        // 敌方最后已知位置（观测子集）：与其它 optional 证据同级，超预算时整体被裁剪
        final String enemyPositions = EnemyLastKnownPositionsSection.renderTeamSection(
                context.reconstruction(), context.battle(), context.perspectiveTeam());
        if (!enemyPositions.isEmpty()) {
            optTemp.append("\n" + enemyPositions);
        }
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

    // ---- 向后兼容的 multi 重载 ----

    static PromptInput multi(final MultiTeamBattleAnalysisContext context) {
        return multi(context, Map.of(), Map.of(), Map.of(), null, Integer.MAX_VALUE);
    }

    static PromptInput multi(final MultiTeamBattleAnalysisContext context,
                             final Map<String, List<String>> evidenceLimitations) {
        return multi(context, evidenceLimitations, Map.of(), Map.of(), null, Integer.MAX_VALUE);
    }

    // ---- 主入口（带 token 预算） ----

    static PromptInput multi(final MultiTeamBattleAnalysisContext context,
                             final Map<String, List<String>> evidenceLimitations,
                             final Map<String, PreBattleStrategicPrior> priorsByUnitId,
                             final Map<String, Integer> perspectiveTeamByUnitId,
                             final AiTokenEstimator estimator,
                             final int maxInputTokens) {
        final List<TeamBattleAnalysisSummary> perspectives = context.perspectives();
        final Set<String> globalLimitations = new LinkedHashSet<>(context.limitations());

        // 构建 global header
        final String globalHeader = "=== MULTI_TEAM_CONTEXT ===\n" +
                "perspectiveCount=" + context.perspectiveCount() + "\n" +
                "uniqueBattleCount=" + context.uniqueBattleCount() + "\n" +
                "rosterConsistent=" + context.rosterConsistent() + "\n";
        if (!context.rosterConsistent()) {
            globalLimitations.add("ROSTER_CONSISTENCY_UNCONFIRMED");
        }

        // 2. 构建所有 perspective 的 mandatory/HPF 内容（临时写入器，不写入 finally）
        final List<PerspectivePromptSections> perspectiveSections = new ArrayList<>(perspectives.size());
        for (int index = 0; index < perspectives.size(); index++) {
            final TeamBattleAnalysisSummary perspective = perspectives.get(index);
            final Set<String> perUnitLimits = new LinkedHashSet<>();
            if (perspective.features() != null) {
                perUnitLimits.addAll(perspective.features().limitations());
            }
            final List<String> evLimits = evidenceLimitations.get(perspective.analysisUnitId());
            if (evLimits != null) {
                perUnitLimits.addAll(evLimits);
            }
            perspectiveSections.add(buildPerspectiveSections(
                    perspective,
                    perUnitLimits,
                    index,
                    priorsByUnitId.get(perspective.analysisUnitId()),
                    perspectiveTeamByUnitId.getOrDefault(perspective.analysisUnitId(), 1)));
        }

        // 3-4. 估算所有 mandatory/HPF 总 token 数，超限则抛异常
        if (estimator != null) {
            final StringBuilder mandatoryBuf = new StringBuilder();
            mandatoryBuf.append(globalHeader);
            for (final PerspectivePromptSections section : perspectiveSections) {
                mandatoryBuf.append(section.priorBlock());
                mandatoryBuf.append(section.mandatoryBlock());
                mandatoryBuf.append(section.highPriorityBlock());
            }
            if (estimator.estimateTextTokens(mandatoryBuf.toString()) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
            }
        }

        // 5. 写入 mandatory 内容到最终 writer
        final TeamEvidenceFormatter.BudgetWriter writer = new TeamEvidenceFormatter.BudgetWriter();
        writer.appendRequired(globalHeader);

        final Set<String> truncatedIds = new LinkedHashSet<>();
        for (final PerspectivePromptSections section : perspectiveSections) {
            writer.appendRequired(section.priorBlock());
            writer.appendRequired(section.mandatoryBlock());
            writer.appendRequiredBlock(section.highPriorityBlock());
            if (section.hpfTruncated()) {
                truncatedIds.add(section.analysisUnitId());
                writer.markTruncated();
            }
        }

        // 6-8. 按 perspective 逐个写入 optional block，检查预算
        for (final PerspectivePromptSections section : perspectiveSections) {
            final String optBlock = section.optionalBlock();
            if (!StringUtils.hasText(optBlock)) {
                continue;
            }
            // 检查下一个 block 是否会导致超限
            if (estimator != null) {
                final String projectedContent = writer.content() + optBlock;
                if (estimator.estimateTextTokens(projectedContent) > maxInputTokens) {
                    truncatedIds.add(section.analysisUnitId());
                    writer.markTruncated();
                    continue;
                }
            }
            writer.append(optBlock);
            if (section.optionalTruncated()) {
                truncatedIds.add(section.analysisUnitId());
                writer.markTruncated();
            }
        }

        final Set<String> includedIds = new LinkedHashSet<>();
        final Map<String, List<String>> perUnitLimMap = new LinkedHashMap<>();
        for (int i = 0; i < perspectives.size(); i++) {
            final String id = perspectives.get(i).analysisUnitId();
            includedIds.add(id);
            perUnitLimMap.put(id, perspectiveSections.get(i).perUnitLimitations());
        }

        // 9. 最终重新估算并保证低于 budget
        return writer.finish(estimator, maxInputTokens,
                globalLimitations, includedIds, Set.of(), truncatedIds, perUnitLimMap);
    }

    // ---- 用于 multi 的辅助方法 ----

    private static PerspectivePromptSections buildPerspectiveSections(
            final TeamBattleAnalysisSummary perspective,
            final Set<String> perUnitLimits,
            final int index,
            final PreBattleStrategicPrior prior,
            final int perspectiveTeam
    ) {
        final String priorBlock = TeamEvidenceFormatter.priorSection(prior, perspectiveTeam, perspective.teamLabel());
        final StringBuilder mandatory = new StringBuilder(512);
        mandatory.append("\n=== PERSPECTIVE ").append(index + 1).append(" ===\n");
        mandatory.append("analysisUnitId=").append(TeamEvidenceFormatter.quoteData(perspective.analysisUnitId())).append("\n");
        mandatory.append("file=").append(TeamEvidenceFormatter.quoteData(perspective.fileName())).append("\n");
        mandatory.append("battleIdentity=").append(TeamEvidenceFormatter.quoteData(perspective.battleIdentity())).append("\n");
        mandatory.append("map=").append(TeamEvidenceFormatter.quoteData(TeamEvidenceFormatter.resolveMapName(perspective.mapName()))).append("\n");
        mandatory.append("category=").append(perspective.battleCategory()).append("\n");
        mandatory.append("durationSec=").append(TeamEvidenceFormatter.formatNullable(perspective.durationSec())).append("\n");
        mandatory.append("teamLabel=").append(TeamEvidenceFormatter.quoteData(perspective.teamLabel())).append("\n");
        mandatory.append("rosterAccountIds=").append(perspective.rosterAccountIds()).append("\n");
        if (!perUnitLimits.isEmpty()) {
            mandatory.append("unitLimitations=").append(perUnitLimits).append("\n");
        }
        final TeamEvidenceFormatter.BudgetWriter hpfTemp = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendHighPriorityFacts(hpfTemp, perspective.features(), perspective.analysisUnitId());
        final String hpfContent = hpfTemp.content();
        final boolean hpfTruncated = hpfTemp.isTruncated();
        final TeamEvidenceFormatter.BudgetWriter optTemp = new TeamEvidenceFormatter.BudgetWriter();
        TeamEvidenceFormatter.appendOptionalDetails(optTemp, perspective.features(), perspective.analysisUnitId(),
                perspective.mapName(), null,
                perspectiveTeam);
        final String optContent = optTemp.content();
        final boolean optTruncated = optTemp.isTruncated();
        return new PerspectivePromptSections(
                perspective.analysisUnitId(),
                priorBlock,
                mandatory.toString(),
                hpfContent,
                hpfTruncated,
                optContent,
                optTruncated,
                List.copyOf(perUnitLimits)
        );
    }

    private record PerspectivePromptSections(
            String analysisUnitId,
            String priorBlock,
            String mandatoryBlock,
            String highPriorityBlock,
            boolean hpfTruncated,
            String optionalBlock,
            boolean optionalTruncated,
            List<String> perUnitLimitations
    ) {
    }

    record PromptInput(
            String content,
            Set<String> includedUnitIds,
            Set<String> omittedUnitIds,
            Set<String> truncatedUnitIds,
            Map<String, List<String>> perUnitLimitations,
            List<String> globalLimitations
    ) {

        PromptInput {
            includedUnitIds = includedUnitIds == null ? Set.of() : Set.copyOf(includedUnitIds);
            omittedUnitIds = omittedUnitIds == null ? Set.of() : Set.copyOf(omittedUnitIds);
            truncatedUnitIds = truncatedUnitIds == null ? Set.of() : Set.copyOf(truncatedUnitIds);
            perUnitLimitations = perUnitLimitations == null ? Map.of() : Map.copyOf(perUnitLimitations);
            globalLimitations = globalLimitations == null ? List.of() : List.copyOf(globalLimitations);
        }
    }

}
