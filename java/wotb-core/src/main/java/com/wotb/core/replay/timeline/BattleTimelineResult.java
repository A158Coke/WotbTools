package com.wotb.core.replay.timeline;

/**
 * BattleTimeline 构建结果：timeline 为 null 时 validation 携带拒绝原因。
 */
public record BattleTimelineResult(
        BattleTimeline timeline,
        BattleTimelineValidationResult validation
) {
    public boolean usable() {
        return timeline != null && validation != null && validation.valid();
    }
}
