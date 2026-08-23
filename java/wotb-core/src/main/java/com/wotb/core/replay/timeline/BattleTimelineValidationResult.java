package com.wotb.core.replay.timeline;

import java.util.List;

/**
 * Timeline 校验结果：valid=false 时携带错误码（用于拒绝 AI Review，禁止 settlement-only fallback）。
 */
public record BattleTimelineValidationResult(
        boolean valid,
        List<TimelineError> errors,
        List<String> messages
) {
    public static BattleTimelineValidationResult ok() {
        return new BattleTimelineValidationResult(true, List.of(), List.of());
    }

    public static BattleTimelineValidationResult invalid(
            final List<TimelineError> errors, final List<String> messages) {
        return new BattleTimelineValidationResult(false,
                List.copyOf(errors), List.copyOf(messages));
    }

    public static BattleTimelineValidationResult invalid(final TimelineError error, final String message) {
        return invalid(List.of(error), List.of(message));
    }
}
