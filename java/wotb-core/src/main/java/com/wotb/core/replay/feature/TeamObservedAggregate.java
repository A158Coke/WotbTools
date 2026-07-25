package com.wotb.core.replay.feature;

/**
 * 事件流中可可靠归因的团队观测子集；不得当作权威整场统计。
 */
public record TeamObservedAggregate(
        int damageDealt,
        int damageReceived,
        int attributedDamageEventCount,
        int unattributedDamageEventCount
) {

    public static TeamObservedAggregate empty() {
        return new TeamObservedAggregate(0, 0, 0, 0);
    }
}
