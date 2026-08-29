package com.wotb.core.replay.timeline;

import com.wotb.core.replay.event.ReplayEvent;

import java.util.List;
import java.util.Map;

/**
 * Canonical Timeline 的 1 秒 BattleFrame。
 * <p>约定（docs/architecture/battle-timeline.md §2.1）：frame second=N 的 stateAt = N.000s（battle-relative），
 * events 为 (N-1, N] 秒内的精确事件——事件保留原始时间精度，Frame 只是状态聚合层。</p>
 */
public record BattleFrame(
        int second,
        double stateAtSec,
        WorldSummary world,
        List<FrameVehicle> vehicles,
        List<ReplayEvent> events,
        List<BattleDelta> deltas,
        Map<String, String> tacticalState,
        List<String> limitations
) {
}
