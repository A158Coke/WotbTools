package com.wotb.core.replay.timeline;

import com.wotb.core.replay.event.ReplayEvent;

import java.util.List;
import java.util.Map;

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
