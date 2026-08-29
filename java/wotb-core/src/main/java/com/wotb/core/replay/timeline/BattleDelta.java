package com.wotb.core.replay.timeline;

import java.util.Map;

/**
 * 帧间确定性变化（Frame(t-1) → Frame(t)）。结构化、可测试、供 AI Context Compiler 渲染，
 * 避免把 raw 位置包灌给 LLM（docs/architecture/battle-timeline.md §14/§15）。
 */
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
