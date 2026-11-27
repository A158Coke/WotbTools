package com.wotb.core.replay.timeline;

import java.util.List;

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
