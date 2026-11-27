package com.wotb.core.replay.timeline;

import java.util.Map;

public record BattleDelta(
        DeltaKind kind,
        int frameSecond,
        double timeSec,
        Integer entityId,
        Map<String, Double> numbers,
        Map<String, String> attributes
) {
    public double number(final String key, final double fallback) {
        return numbers != null && numbers.containsKey(key) ? numbers.get(key) : fallback;
    }

    public String attr(final String key, final String fallback) {
        return attributes != null && attributes.containsKey(key) ? attributes.get(key) : fallback;
    }
}
