package com.wotb.core.replay.feature;

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
