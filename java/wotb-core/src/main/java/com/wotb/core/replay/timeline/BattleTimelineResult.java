package com.wotb.core.replay.timeline;

public record BattleTimelineResult(
        BattleTimeline timeline,
        BattleTimelineValidationResult validation
) {
    public boolean usable() {
        return timeline != null && validation != null && validation.valid();
    }
}
