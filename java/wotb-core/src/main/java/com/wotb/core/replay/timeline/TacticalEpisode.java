package com.wotb.core.replay.timeline;

import java.util.List;

public record TacticalEpisode(
        int index,
        double startSec,
        double endSec,
        WorldSummary before,
        WorldSummary after,
        List<BattleDelta> deltas,
        List<String> tacticalChanges,
        List<String> limitations
) {
    public double durationSec() {
        return endSec - startSec;
    }
}
