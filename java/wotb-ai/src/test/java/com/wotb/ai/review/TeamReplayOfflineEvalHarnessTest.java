package com.wotb.ai.review;

import com.wotb.ai.review.eval.TeamReplayQualityCase;
import com.wotb.ai.review.eval.TeamReplayQualityCaseLoader;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamReplayOfflineEvalHarnessTest {

    @Test
    void everyGoldCaseUsesTheProductionOfflineEvidenceChain() throws Exception {
        for (final TeamReplayQualityCase qualityCase : TeamReplayQualityCaseLoader.loadAll()) {
            final ReplayFactsFixtures.Facts processed = ReplayFactsFixtures.load(qualityCase.replay());
            assertNotNull(processed.battle(), qualityCase.id() + " battle was not parsed");
            assertNotNull(processed.reconstruction(), qualityCase.id() + " reconstruction was not built");

            final SingleTeamBattleAnalysisContext context = TeamContextBuilder.buildSingleTeamContext(
                    processed.battle(), processed.reconstruction());
            final BattleTimelineResult timelineResult = BattleTimelineBuilder.build(
                    context.battle(), context.reconstruction(), TimelinePerspective.team(context.perspectiveTeam()));
            assertTrue(timelineResult.usable(), qualityCase.id() + " timeline unusable: "
                    + timelineResult.validation().errors());
            final BattleTimeline timeline = timelineResult.timeline();
            final TeamGroundingFacts.GroundingFacts facts = TeamGroundingFacts.build(
                    context.battle(), timeline, context.perspectiveTeam());
            assertFalse(facts.facts().isEmpty(), qualityCase.id() + " has no grounding facts");

            final String prompt = TeamAiPromptBuilder.single(
                    context, List.of(), null, null, Integer.MAX_VALUE, timeline).content();
            assertTrue(prompt.contains("TACTICAL TIMELINE"), qualityCase.id() + " omitted production timeline");
            final String systemPrompt = TeamPromptLocalizer.systemPrompt(AllowedLanguage.ZH);
            assertTrue(systemPrompt.contains("团队复盘推理顺序"),
                    qualityCase.id() + " omitted reasoning contract");
            assertFalse(prompt.contains(qualityCase.id()),
                    qualityCase.id() + " gold case id leaked into the production prompt");

            for (final String requirement : qualityCase.evidenceRequired()) {
                final String factType = switch (requirement) {
                    case "POSITION_REGION" -> TeamGroundingFacts.TYPE_POSITION_REGION;
                    case "ENEMY_POSITION" -> TeamGroundingFacts.TYPE_ENEMY_POSITION;
                    case "FOCUS_WINDOW" -> TeamGroundingFacts.TYPE_FOCUS_WINDOW;
                    case "ALIVE_COUNT_TRANSITION" -> TeamGroundingFacts.TYPE_ALIVE_TRANSITION;
                    default -> throw new AssertionError("Unknown gold evidence requirement: " + requirement);
                };
                assertTrue(facts.facts().stream().anyMatch(f -> factType.equals(f.type())),
                        qualityCase.id() + " missing required evidence type " + requirement);
            }
        }
    }
}
