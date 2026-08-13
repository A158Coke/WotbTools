package com.wotb.web.replay.ai.eval;

import com.wotb.web.replay.ai.AiPromptLibrary;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** CI 模式评估：加载 golden cases → 构建 prompt → 断言 → 写报告；任一 FAIL 构建失败。 */
@Tag("ai-eval")
class AiEvalHarnessTest {

    @Test
    void teamSystemPromptCarriesSoloIntentAndCaptureRules() {
        final String systemPrompt = AiPromptLibrary.zh("team/single");
        assertTrue(systemPrompt.contains("单走行为判定规则"), "team system prompt must carry SOLO_INTENT_RULE");
        assertTrue(systemPrompt.contains("争霸赛占点规则"), "team system prompt must carry CAPTURE_RULE");
        assertTrue(systemPrompt.contains("玩家心理意图"),
                "intent clause must allow observable behavior patterns while banning mental-intent claims");
        assertTrue(systemPrompt.contains("全歼敌方"),
                "CAPTURE_RULE must list annihilation as a victory mode ahead of points inference");
        assertFalse(systemPrompt.contains("若双方均 <1000 → 必然"),
                "CAPTURE_RULE must not force time-expired points win whenever both teams are below 1000");
    }

    @Test
    void goldenCasesPassPromptChecks() throws Exception {
        final List<AiEvalCase> cases = AiEvalCaseLoader.loadAll();
        assertFalse(cases.isEmpty(), "at least one golden case must be registered");

        final List<AiEvalReportWriter.CaseResult> results = cases.stream()
                .map(caze -> {
                    final String prompt = AiEvalPromptProbe.prompt(caze);
                    final List<AiEvalAssertions.CheckResult> checks =
                            AiEvalAssertions.evaluate(caze, prompt);
                    return new AiEvalReportWriter.CaseResult(
                            caze, AiEvalAssertions.allPassed(checks), checks);
                })
                .toList();

        AiEvalReportWriter.write(results);

        final List<String> failed = results.stream()
                .filter(result -> !result.passed())
                .map(result -> result.caze().id())
                .toList();
        assertTrue(failed.isEmpty(), "golden cases failed: " + failed);
    }
}
