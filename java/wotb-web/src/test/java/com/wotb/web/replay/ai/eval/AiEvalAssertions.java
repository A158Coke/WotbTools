package com.wotb.web.replay.ai.eval;

import java.util.ArrayList;
import java.util.List;

/**
 * 执行 golden case 的 prompt 级断言（CI 零 AI 成本）。
 */
public final class AiEvalAssertions {

    private AiEvalAssertions() {
    }

    public record CheckResult(AiEvalCase.Check check, boolean passed) {
    }

    public static List<CheckResult> evaluate(final AiEvalCase caze, final String prompt) {
        final List<CheckResult> results = new ArrayList<>();
        for (final AiEvalCase.Check check : caze.checks()) {
            final boolean passed = switch (check.kind()) {
                case "prompt_contains" -> prompt.contains(check.text());
                case "prompt_omits" -> !prompt.contains(check.text());
                default -> throw new IllegalArgumentException(
                        "Unknown check kind '" + check.kind() + "' in case " + caze.id());
            };
            results.add(new CheckResult(check, passed));
        }
        return results;
    }

    public static boolean allPassed(final List<CheckResult> results) {
        return results.stream().allMatch(CheckResult::passed);
    }
}
