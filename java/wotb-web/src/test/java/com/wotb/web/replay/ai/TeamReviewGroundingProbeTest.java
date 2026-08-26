package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 手动探针（不进 CI）：真实 team replay 的 Grounding Facts 规模 + Team Call #2 prompt token 估算。
 * Run: {@code mvn -pl wotb-web -am test -Dtest=TeamReviewGroundingProbeTest -Dprobe.replay=<file>}
 * 无 -Dprobe.replay 时回退到 common/data 的 neptune+SPHT 团队样本。输出各段规模。
 */
class TeamReviewGroundingProbeTest {

    private static final String LOCAL_NEPTUNE_SPHT_SAMPLE =
            "data/probe-local/neptune1.wotbreplay";

    @Test
    void probe() throws Exception {
        String path = System.getProperty("probe.replay");
        if (path == null) {
            path = LOCAL_NEPTUNE_SPHT_SAMPLE;
        }
        final Path file = Path.of(path);
        Assumptions.assumeTrue(Files.exists(file), "sample missing: " + file);
        final byte[] bytes = Files.readAllBytes(file);
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new Source(file.getFileName().toString(), bytes), ReplayProcessingOptions.full());
        Assumptions.assumeTrue(result.battle() != null && result.battle().players != null, "no battle parsed");
        Assumptions.assumeTrue(result.reconstruction() != null, "no reconstruction");
        final Battle battle = result.battle();
        final int recorderTeam = battle.recorderResult() != null ? battle.recorderResult().team : 1;

        final BattleTimelineResult tlResult = BattleTimelineBuilder.build(
                battle, result.reconstruction(), TimelinePerspective.team(recorderTeam));
        Assumptions.assumeTrue(tlResult.usable() && tlResult.timeline() != null,
                "timeline unusable: " + tlResult.validation().errors());
        final BattleTimeline timeline = tlResult.timeline();

        final TeamGroundingFacts.GroundingFacts facts =
                TeamGroundingFacts.build(battle, timeline, recorderTeam);
        final AiTokenEstimator est = new ConservativeDeepSeekTokenEstimator();

        System.out.println("===== 真实回放: " + file.getFileName());
        System.out.println("map=" + battle.mapName + " arenaBonusType=" + battle.arenaBonusType
                + " duration=" + timeline.durationSec() + "s perspectiveTeam=" + recorderTeam
                + " players=" + battle.players.size());

        final Map<String, Long> byType = facts.facts().stream()
                .collect(java.util.stream.Collectors.groupingBy(
                        TeamGroundingFacts.EvidenceFact::type, java.util.stream.Collectors.counting()));
        System.out.println("grounding facts total=" + facts.facts().size() + " byType=" + byType);
        System.out.println("aliveTransitions=" + facts.aliveTransitions().size()
                + " regionSnapshots=" + facts.regionSnapshots().size()
                + " enemyPositions=" + facts.enemyPositions().size());

        final String groundingSection = TeamGroundingFacts.renderGroundingSection(facts);
        System.out.println("===== prompt 规模（ConservativeDeepSeekTokenEstimator，估算）");
        System.out.println("GROUNDING FACTS 段 字符数=" + groundingSection.length()
                + " 估算token=" + est.estimateTextTokens(groundingSection));

        // TACTICAL TIMELINE 段（TeamAiContextCompiler 渲染，不需要 features）
        final String timelineSection = TeamAiContextCompiler.renderTimelineSection(timeline, recorderTeam);
        final String focusWindows = TeamAiContextCompiler.renderFocusWindowsSection(timeline, recorderTeam);
        System.out.println("TACTICAL TIMELINE 段 字符数=" + timelineSection.length()
                + " 估算token=" + est.estimateTextTokens(timelineSection));
        System.out.println("FOCUS WINDOWS 段 字符数=" + focusWindows.length()
                + " 估算token=" + est.estimateTextTokens(focusWindows));

        // system prompt 静态部分
        final String systemPrompt = TeamPromptLocalizer.localizeTeamSystemPrompt(
                TeamPromptLocalizer.SINGLE_TEAM_PROMPT, AllowedLanguage.ZH);
        System.out.println("system prompt 字符数=" + systemPrompt.length()
                + " 估算token=" + est.estimateTextTokens(systemPrompt));

        // 全量（无 features 的最小 prompt：system + content(仅 timeline+grounding)）
        final String baseUser = timelineSection + focusWindows
                + (groundingSection.isEmpty() ? "" : "\n" + groundingSection);
        System.out.println("估算 baseUser(system+timeline+focus+grounding) 总token="
                + (est.estimateTextTokens(systemPrompt) + est.estimateTextTokens(baseUser)));
        System.out.println("提示：真实 prompt 还包含 HPF/optional evidence 段（依赖 features，本 probe 不估算）");

        System.out.println("===== GROUNDING FACTS 段（前 25 行） =====");
        final String[] lines = groundingSection.split("\n");
        for (int i = 0; i < Math.min(25, lines.length); i++) {
            System.out.println(lines[i]);
        }
        if (lines.length > 25) {
            System.out.println("... (共 " + lines.length + " 行) ...");
        }
        System.out.println("===== TACTICAL TIMELINE 段（前 30 行） =====");
        final String[] tlLines = timelineSection.split("\n");
        for (int i = 0; i < Math.min(30, tlLines.length); i++) {
            System.out.println(tlLines[i]);
        }
        if (tlLines.length > 30) {
            System.out.println("... (共 " + tlLines.length + " 行) ...");
        }
    }
}
