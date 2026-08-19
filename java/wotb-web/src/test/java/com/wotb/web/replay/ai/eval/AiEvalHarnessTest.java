package com.wotb.web.replay.ai.eval;

import com.wotb.web.replay.ai.AiPromptLibrary;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * CI 模式评估：加载 golden cases → 构建 prompt → 断言 → 写报告；任一 FAIL 构建失败。
 */
@Tag("ai-eval")
class AiEvalHarnessTest {

    @Test
    void teamSystemPromptCarriesSoloIntentAndCaptureRules() {
        final String systemPrompt = AiPromptLibrary.zh("team/single");
        assertTrue(systemPrompt.contains("空间分离证据使用规则"),
                "team system prompt must carry SEPARATION_EVIDENCE_RULE");
        assertTrue(systemPrompt.contains("争霸赛占点规则"), "team system prompt must carry CAPTURE_RULE");
        assertTrue(systemPrompt.contains("玩家心理意图"),
                "intent clause must allow observable behavior patterns while banning mental-intent claims");
        assertTrue(systemPrompt.contains("全歼敌方"),
                "CAPTURE_RULE must list annihilation as a victory mode ahead of points inference");
        assertFalse(systemPrompt.contains("若双方均 <1000 → 必然"),
                "CAPTURE_RULE must not force time-expired points win whenever both teams are below 1000");
        assertTrue(systemPrompt.contains("resultSource"),
                "CAPTURE_RULE must reference resultSource evidence levels");
        assertTrue(systemPrompt.contains("BATTLE_RESULTS")
                        && systemPrompt.contains("SURVIVOR_SETTLEMENT"),
                "CAPTURE_RULE must describe the resultSource evidence levels");
        assertTrue(systemPrompt.contains("无权威胜方"),
                "CAPTURE_RULE must fail closed when the authoritative winner is missing");
        assertTrue(systemPrompt.contains("被敌方全歼落败"),
                "CAPTURE_RULE must carry bidirectional annihilation wording");
    }

    @Test
    void teamSystemPromptCarriesEvidenceContractAndBansCausalOverreach() {
        // AI Review V2.1 Quality Gate（docs/current-plan.md §12）：真实失败案例
        // 20260817 WildCat SPHT 回放暴露的因果过度断言，必须在 prompt 契约层被禁止。
        final String zh = AiPromptLibrary.zh("team/single");
        assertTrue(zh.contains("证据契约（强制）：FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN"),
                "must carry the evidence contract");
        assertTrue(zh.contains("3. UNKNOWN（未知）是正常答案，不是失败答案"),
                "UNKNOWN must be a normal answer, not a failure");
        assertTrue(zh.contains("5. 没有对应后端证据时，禁止输出以下断言或其同义改写"),
                "must list forbidden claims");
        assertTrue(zh.contains("没有掩体切割") && zh.contains("hull-down") && zh.contains("对方有无遮挡射界"),
                "must ban terrain/cover/LOS claims");
        assertTrue(zh.contains("A 提供了具体视野") && zh.contains("A 点亮了 B")
                        && zh.contains("A 获得了侦察收益") && zh.contains("开局散开就是图控/拿视野"),
                "must ban specific vision/spotting claims without dedicated visibility evidence");
        assertTrue(zh.contains("分散可以扩大地图信息覆盖") || zh.contains("地图信息覆盖"),
                "must allow the general information-coverage trade-off");
        assertTrue(zh.contains("禁止创造「15米」「25米」「三分之一血」「连续两炮」「5秒」等精确阈值"),
                "must ban magic-number coaching");
        assertTrue(zh.contains("禁止「2v4/3v5 就必须立刻离开当前掩体向地图另一端转移」"),
                "must ban the endgame universal rule");
        assertTrue(zh.contains("h. 车辆角色类"), "must ban self-invented vehicle roles");
        assertFalse(zh.contains("是图控/拿视野，不是脱节"),
                "old 'opening spread = map control' rule must be gone");
        assertFalse(zh.contains("10) 3-5 条可执行训练建议"),
                "old ten-chapter structure must be gone");
        // 输出结构
        assertTrue(zh.contains("1. 核心结论：2-4 句"), "must carry the core-conclusion section");
        assertTrue(zh.contains("2. 关键决策窗口"), "must carry the key-decision-window section");
        assertTrue(zh.contains("3. 可确认的团队问题"), "must carry the confirmed-problems section");
        assertTrue(zh.contains("4. 训练建议"), "must carry the training-recommendation section");
        assertTrue(zh.contains("每一条必须明确对应前面的一个「可确认问题」"),
                "training recommendations must map to confirmed issues");
        assertTrue(zh.contains("没有足够强的 positive 证据时不得硬写「做得好的团队行为」"),
                "must not force a positive section");
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