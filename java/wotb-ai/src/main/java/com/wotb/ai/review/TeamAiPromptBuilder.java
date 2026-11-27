package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.timeline.BattleTimeline;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class TeamAiPromptBuilder {

    private TeamAiPromptBuilder() {
    }


    static String structuredTankFacts(final long tankId) {
        return TeamRosterFormatter.structuredTankFacts(tankId);
    }

    static String extraInfoFact(final String extraInfo) {
        return TeamRosterFormatter.extraInfoFact(extraInfo);
    }


    public static PromptInput single(final SingleTeamBattleAnalysisContext context) {
        return single(context, List.of(), null, null, Integer.MAX_VALUE);
    }


    public static PromptInput single(
            final SingleTeamBattleAnalysisContext context,
            final List<String> extraLimitations,
            final PreBattleStrategicPrior prior,
            final AiTokenEstimator estimator,
            final int maxInputTokens
    ) {
        return single(context, extraLimitations, prior, estimator, maxInputTokens, (String) null);
    }

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

        final TeamPromptBudgetWriter hpfTemp = new TeamPromptBudgetWriter();
        final Map<Long, PlayerResult> playersByAccount = new HashMap<>();
        if (context.battle() != null && context.battle().players != null) {
            for (final PlayerResult p : context.battle().players) {
                if (p != null) {
                    playersByAccount.put(p.accountId, p);
                }
            }
        }
        TeamBattleEvidenceFormatter.appendHighPriorityFacts(
                hpfTemp, context.features(), context.analysisUnitId(), List.copyOf(limitations),
                playersByAccount);
        if (!TeamRosterFormatter.appendOpposingTeam(hpfTemp, context.battle(), context.perspectiveTeam())) {
            limitations.add("OPPOSING_LINEUP_UNAVAILABLE");
        }
        final String hpfBlock = hpfTemp.content();
        final String priorBlock = TeamPriorFormatter.priorSection(
                prior, context.perspectiveTeam(),
                context.battle() != null
                        ? TeamRosterFormatter.resolveDisplayLabel(context.battle().players, context.perspectiveTeam())
                        : "");

        final StringBuilder headerBuf = new StringBuilder();
        headerBuf.append("=== SINGLE_TEAM_CONTEXT ===\n");
        headerBuf.append("analysisUnitId=").append(TeamEvidenceFormatter.quoteData(context.analysisUnitId())).append("\n");
        headerBuf.append("file=").append(TeamEvidenceFormatter.quoteData(context.fileName())).append("\n");
        headerBuf.append("battleIdentity=").append(TeamEvidenceFormatter.quoteData(context.battleId())).append("\n");
        headerBuf.append("category=").append(context.battleCategory()).append("\n");
        if (context.battle() != null) {
            final String teamLabel = TeamRosterFormatter.resolveDisplayLabel(
                    context.battle().players, context.perspectiveTeam());
            final String opponentLabel = TeamRosterFormatter.resolveOpponentDisplayLabel(
                    context.battle().players, context.perspectiveTeam());
            headerBuf.append("teamDisplayLabel=").append(
                    StringUtils.hasText(teamLabel) ? TeamEvidenceFormatter.quoteData(teamLabel) : "(none)").append("\n");
            headerBuf.append("opponentDisplayLabel=").append(
                    StringUtils.hasText(opponentLabel) ? TeamEvidenceFormatter.quoteData(opponentLabel) : "(none)").append("\n");
            headerBuf.append("map=").append(TeamEvidenceFormatter.quoteData(TeamEvidenceFormatter.resolveMapName(context.battle().mapName))).append("\n");
            headerBuf.append("durationSec=").append(TeamEvidenceFormatter.formatNullable(context.battle().durationS)).append("\n");
            final String result = TeamOutcomeFormatter.resolveTeamResult(
                    context.battle(), context.perspectiveTeam(), teamLabel);
            headerBuf.append("result=").append(result).append("\n");
            headerBuf.append("resultSource=").append(TeamOutcomeFormatter.resolveTeamResultSource(
                    context.battle(), context.perspectiveTeam())).append("\n");
        }
        headerBuf.append("unitLimitations=").append(limitations).append("\n");
        final String headerBlock = headerBuf.toString();

        String optBlock = buildOptionalBlock(context, limitations, true, timelineBlock);

        if (estimator != null) {
            final String mandatoryContent = headerBlock + priorBlock + hpfBlock;
            if (estimator.estimateTextTokens(mandatoryContent) > maxInputTokens) {
                throw new AiPromptBudgetExceededException();
            }
            if (estimator.estimateTextTokens(mandatoryContent + optBlock) > maxInputTokens) {
                final String optNoPoints = buildOptionalBlock(context, limitations, false, timelineBlock);
                if (!optNoPoints.equals(optBlock)) {
                    optBlock = optNoPoints;
                }
            }
        }

        final TeamPromptBudgetWriter writer = new TeamPromptBudgetWriter();
        writer.appendRequired(headerBlock);
        writer.appendRequired(priorBlock);
        writer.appendRequiredBlock(hpfBlock);
        writer.append(optBlock);

        return writer.finish(estimator, maxInputTokens,
                Set.of(), Set.of(context.analysisUnitId()), Set.of(), Set.of(),
                Map.of(context.analysisUnitId(), List.copyOf(limitations)));
    }

    private static String buildOptionalBlock(
            final SingleTeamBattleAnalysisContext context,
            final Set<String> limitations,
            final boolean includePointsSituation,
            final String timelineBlock
    ) {
        final TeamPromptBudgetWriter optTemp = new TeamPromptBudgetWriter();
        if (timelineBlock != null && !timelineBlock.isBlank()) {
            optTemp.append(timelineBlock);
        }
        TeamBattleEvidenceFormatter.appendOptionalDetails(optTemp, context.features(), context.analysisUnitId(),
                context.battle() == null ? null : context.battle().mapName,
                context.battle(), context.perspectiveTeam(), List.copyOf(limitations));
        final String enemyPositions = EnemyLastKnownPositionsSection.renderTeamSection(
                context.reconstruction(), context.battle(), context.perspectiveTeam());
        if (!enemyPositions.isEmpty()) {
            optTemp.append("\n" + enemyPositions);
        }
        TeamBattleEvidenceFormatter.appendMemberDamageReceivedWindows(
                optTemp,
                context.battle(),
                context.features() == null ? List.of() : context.features().members(),
                context.reconstruction(),
                limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        if (includePointsSituation) {
            TeamOutcomeFormatter.appendPointsSituation(
                    optTemp,
                    context.battle(),
                    context.reconstruction(),
                    context.perspectiveTeam(),
                    limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        }
        final String formationDepth = FormationDepthEvidence.renderSection(
                context.battle(),
                context.reconstruction(),
                context.perspectiveTeam(),
                context.battle() == null ? null : context.battle().mapName);
        if (!formationDepth.isEmpty()) {
            optTemp.append(formationDepth);
        }
        final String behindLine = RelativeDepthHpEvidence.renderTeamSection(
                context.battle(),
                context.reconstruction(),
                context.perspectiveTeam(),
                limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        if (!behindLine.isEmpty()) {
            optTemp.append(behindLine);
        }
        return optTemp.content();
    }

    static String renderTimelineBlock(final BattleTimeline timeline, final int perspectiveTeam) {
        if (timeline == null) {
            return "";
        }
        final String section = TeamAiContextCompiler.renderTimelineSection(timeline, perspectiveTeam);
        if (section.isBlank()) {
            throw new IllegalStateException(
                    "validated team timeline rendered blank TACTICAL TIMELINE: map=" + timeline.mapCode());
        }
        final String focusWindows = TeamAiContextCompiler.renderFocusWindowsSection(timeline, perspectiveTeam);
        final String objectiveState = TeamAiContextCompiler.renderObjectiveStateSection(timeline, perspectiveTeam);
        return "\n=== TACTICAL TIMELINE（时间有序战局章节·battle-relative 确定性） ===\n" + section
                + (objectiveState.isBlank() ? "" : "\n" + objectiveState)
                + (focusWindows.isBlank() ? "" : "\n" + focusWindows);
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
