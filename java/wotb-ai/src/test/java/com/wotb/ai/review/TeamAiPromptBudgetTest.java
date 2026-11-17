package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFeatureCoverage;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamAiPromptBudgetTest extends TeamAiPromptBuilderTestSupport {
@Test
    void singlePromptCapsMembersAndReportsTruncation() {
        final SingleTeamBattleAnalysisContext context = contextWithMembers(18, 8);

        final TeamAiPromptBuilder.PromptInput input =
                TeamAiPromptBuilder.single(context);

        assertNotNull(input.content());
        assertEquals(
                18,
                occurrences(input.content(), "member accountId="));
        assertFalse(input.globalLimitations().contains("AI_INPUT_TRUNCATED"));
        assertFalse(input.content().contains("ReplayEvent{"));
    }
    @Test
    void singlePromptNeverExceedsCharacterBudget() {
        final SingleTeamBattleAnalysisContext context =
                contextWithMembers(18, 200);

        final TeamAiPromptBuilder.PromptInput input =
                TeamAiPromptBuilder.single(context);

        assertNotNull(input.content());
        assertFalse(input.globalLimitations().contains("AI_INPUT_TRUNCATED"));
        assertFalse(input.content().contains(
                "LIMITATION: AI_INPUT_TRUNCATED\n"));
    }
    @Test
    void truncationPreservesMandatoryLimitations() {
        final SingleTeamBattleAnalysisContext base = contextWithMembers(20, 400);
        final TeamBattleFeatureSet featuresWithLim = new TeamBattleFeatureSet(
                base.features().perspectiveTeam(),
                base.features().members(),
                base.features().authoritativeAggregate(),
                base.features().observedAggregate(),
                base.features().formationPhases(),
                base.features().engagements(),
                base.features().battlePhases(),
                base.features().keyEvents(),
                base.features().coverage(),
                List.of("OBSERVED_DAMAGE_IS_PARTIAL"),
                true);
        final SingleTeamBattleAnalysisContext context =
                new SingleTeamBattleAnalysisContext(
                        base.analysisUnitId(), base.battleId(), base.fileName(),
                        base.battleCategory(), base.battle(), 1, featuresWithLim,
                        base.coverage(), base.limitations(), null);

        final TeamAiPromptBuilder.PromptInput input =
                TeamAiPromptBuilder.single(context);

        assertNotNull(input.content());
        assertFalse(input.globalLimitations().contains("AI_INPUT_TRUNCATED"));
        assertTrue(input.content().contains("unitLimitations="),
                "Content must contain unitLimitations=");
        final int unitLimPos = input.content().indexOf("unitLimitations=");
        final int authPos = input.content().indexOf("AUTHORITATIVE_TEAM_RESULT");
        assertTrue(unitLimPos >= 0 && authPos > unitLimPos,
                "unitLimitations= must precede bulk feature data (AUTHORITATIVE_TEAM_RESULT)");
        assertFalse(input.content().contains("LIMITATION: AI_INPUT_TRUNCATED\n"),
                "Content must end with AI_INPUT_TRUNCATED");
    }
    @Test
    void singleTruncationReportConsistentWithBody() {
        final SingleTeamBattleAnalysisContext base = contextWithMembers(20, 400);
        final TeamBattleFeatureSet featuresWithLim = new TeamBattleFeatureSet(
                base.features().perspectiveTeam(),
                base.features().members(),
                base.features().authoritativeAggregate(),
                base.features().observedAggregate(),
                base.features().formationPhases(),
                base.features().engagements(),
                base.features().battlePhases(),
                base.features().keyEvents(),
                base.features().coverage(),
                List.of("OBSERVED_DAMAGE_IS_PARTIAL"),
                true);
        final SingleTeamBattleAnalysisContext context =
                new SingleTeamBattleAnalysisContext(
                        base.analysisUnitId(), base.battleId(), base.fileName(),
                        base.battleCategory(), base.battle(), 1, featuresWithLim,
                        base.coverage(), base.limitations(), null);

        final TeamAiPromptBuilder.PromptInput input =
                TeamAiPromptBuilder.single(context);

        assertFalse(input.globalLimitations().contains("AI_INPUT_TRUNCATED"));
        assertFalse(input.content().contains("AI_INPUT_TRUNCATED"));
        assertTrue(input.perUnitLimitations().getOrDefault(base.analysisUnitId(), List.of()).contains("OBSERVED_DAMAGE_IS_PARTIAL"));
    }
    @Test
    void pointsSituationBlockIsTrimmedAsWholeWhenOverBudget() {
        final AiTokenEstimator estimator = new ConservativeDeepSeekTokenEstimator();
        final SingleTeamBattleAnalysisContext context = pointsSituationContext();
        final TeamAiPromptBuilder.PromptInput full =
                TeamAiPromptBuilder.single(context, List.of(), null, estimator, 1_000_000);
        assertTrue(full.content().contains("=== POINTS_SITUATION"),
                "full content must carry the points-situation block");
        final int fullTokens = estimator.estimateTextTokens(full.content());
        final int pointsStart = full.content().indexOf("=== POINTS_SITUATION");
        final int blockEnd = full.content().indexOf("===", pointsStart + 10);
        final int blockTokens = estimator.estimateTextTokens(
                full.content().substring(pointsStart, blockEnd < 0 ? full.content().length() : blockEnd));
        final int budget = Math.max(1, fullTokens - blockTokens + blockTokens / 2);
        assertTrue(budget < fullTokens, "budget must exceed with the points block");
        assertTrue(budget > fullTokens - blockTokens, "budget must fit without the points block");

        final TeamAiPromptBuilder.PromptInput trimmed =
                TeamAiPromptBuilder.single(context, List.of(), null, estimator, budget);

        assertTrue(estimator.estimateTextTokens(trimmed.content()) <= budget,
                "trimmed content must fit the budget (no AI_INPUT_TRUNCATED tail)");
        assertFalse(trimmed.content().contains("POINTS_SITUATION"),
                "the whole POINTS_SITUATION block must be removed");
        assertTrue(trimmed.content().contains("SINGLE_TEAM_CONTEXT"), "mandatory header must remain");
        assertTrue(trimmed.content().contains("AUTHORITATIVE_TEAM_RESULT"), "mandatory HPF must remain");
        assertTrue(trimmed.content().contains("unitLimitations="), "mandatory limitations must remain");
        assertFalse(trimmed.globalLimitations().contains("AI_INPUT_TRUNCATED"));
    }
}
