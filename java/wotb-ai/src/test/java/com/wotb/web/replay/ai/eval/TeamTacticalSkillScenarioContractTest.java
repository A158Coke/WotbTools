package com.wotb.web.replay.ai.eval;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Keeps the manual live-probe inputs facts-only; expected behavior stays in assertions. */
class TeamTacticalSkillScenarioContractTest {

    private static final List<String> JUDGMENT_MARKERS = List.of(
            "判断为", "应讨论", "不应机械", "不要机械", "不得", "只能写",
            "边际价值下降", "目标压力变大", "提高基地优先级", "不机械放弃",
            "必须放弃");

    @Test
    void allLiveScenariosContainFactsWithoutExpectedJudgment() {
        final Map<String, TeamTacticalSkillLiveBehaviorEvalTest.BehaviorSpec> specs =
                TeamTacticalSkillLiveBehaviorEvalTest.specs();
        assertEquals(8, specs.size(), "live behavior evaluation must keep A-H scenarios");

        final List<String> leakedJudgments = specs.entrySet().stream()
                .flatMap(entry -> JUDGMENT_MARKERS.stream()
                        .filter(marker -> entry.getValue().scenario().contains(marker))
                        .map(marker -> entry.getKey() + ": " + marker))
                .toList();
        assertTrue(leakedJudgments.isEmpty(),
                "live scenarios must provide facts only; expected judgment leaked: " + leakedJudgments);
    }
}
