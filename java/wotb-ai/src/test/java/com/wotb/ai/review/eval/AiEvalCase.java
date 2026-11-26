package com.wotb.ai.review.eval;

import java.util.List;

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

    public record Check(String kind, String text) {
    }
}
