package com.wotb.web.replay.ai.eval;

import java.util.List;

/**
 * AI 复盘评估 golden case：synthetic 7v7 训练房/联赛场景 + prompt 级断言。
 * <p>{@code expectedJudgment} 仅作人工评估/lesson 参照，CI 只断言 {@code checks}。
 * Step 2（图控/脱节/拖延证据）落地后在同一 case 上追加意图断言。</p>
 */
public record AiEvalCase(
        String id,
        String mode,
        Integer arenaBonusType,
        String fixtureKey,
        String lessonRef,
        String expectedJudgment,
        List<Check> checks,
        String note
) {

    public AiEvalCase {
        checks = checks == null ? List.of() : List.copyOf(checks);
    }

    /** 检查项：kind 支持 prompt_contains / prompt_omits / system_prompt_contains / system_prompt_omits。 */
    public record Check(String kind, String text) {
    }
}
