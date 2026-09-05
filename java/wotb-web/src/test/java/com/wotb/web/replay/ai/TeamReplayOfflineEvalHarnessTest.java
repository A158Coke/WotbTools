package com.wotb.web.replay.ai;

import com.wotb.core.model.Source;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.BatchAnalyzer;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.replay.ai.eval.TeamReplayQualityCase;
import com.wotb.web.replay.ai.eval.TeamReplayQualityCaseLoader;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Zero-token real-replay harness. It deliberately stops before any gateway:
 * production parser → reconstruction → timeline → team context → prompt →
 * grounding facts. Gold files constrain evidence availability only; they do not
 * contain or get appended to a model prompt.
 */
class TeamReplayOfflineEvalHarnessTest {

    @Test
    void everyGoldCaseUsesTheProductionOfflineEvidenceChain() throws Exception {
        for (final TeamReplayQualityCase qualityCase : TeamReplayQualityCaseLoader.loadAll()) {
            final Path replay = resolveReplay(qualityCase.replay());
            assertTrue(Files.isRegularFile(replay), qualityCase.id() + " replay missing: " + replay);
            final ReplayProcessingResult processed = new DefaultReplayProcessingFacade().process(
                    new Source(replay.getFileName().toString(), Files.readAllBytes(replay)),
                    ReplayProcessingOptions.full());
            assertNotNull(processed.battle(), qualityCase.id() + " battle was not parsed");
            assertNotNull(processed.reconstruction(), qualityCase.id() + " reconstruction was not built");

            final List<ReplayPerspectiveGroup> groups = new BatchAnalyzer()
                    .analyze(List.of(processed)).groups();
            assertFalse(groups.isEmpty(), qualityCase.id() + " has no perspective group");
            final SingleTeamBattleAnalysisContext context = TeamContextBuilder.buildSingleTeamContext(groups.getFirst());
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
            final String systemPrompt = TeamPromptLocalizer.localizeTeamSystemPrompt(
                    TeamPromptLocalizer.SINGLE_TEAM_PROMPT, AllowedLanguage.ZH);
            assertTrue(systemPrompt.contains("团队推理顺序"),
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

    private static Path resolveReplay(final String replay) throws IOException {
        final Path cwd = Path.of(System.getProperty("user.dir"));
        final List<Path> candidates = List.of(
                cwd.resolve(replay).normalize(),
                cwd.resolve("..").resolve(replay).normalize(),
                cwd.resolve("..").resolve("..").resolve(replay).normalize());
        return candidates.stream().filter(Files::isRegularFile).findFirst().orElse(candidates.getFirst());
    }
}
