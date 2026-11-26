package com.wotb.core.replay.timeline;

public record FrameHealth(
        Integer currentHp,
        Double observedAtSec,
        Double ageSec,
        HpSource source,
        HealthKnowledge knowledge,
        Integer displayCapacityHp,
        Confidence confidence
) {
    public static FrameHealth unknown() {
        return new FrameHealth(null, null, null, HpSource.UNKNOWN,
                HealthKnowledge.UNKNOWN, null, Confidence.UNKNOWN);
    }

    public enum HealthKnowledge {
        CURRENT,
        LAST_KNOWN,
        UNKNOWN
    }
}
