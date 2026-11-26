package com.wotb.core.replay.timeline;

import com.wotb.core.replay.reconstruction.Vector3;

public record FramePosition(
        Vector3 position,
        Double positionObservedAtSec,
        Double positionAgeSec,
        PositionKnowledge knowledge,
        PositionSource source,
        Confidence confidence
) {
    public static final FramePosition UNKNOWN = new FramePosition(
            null, null, null, PositionKnowledge.UNKNOWN, PositionSource.UNKNOWN, Confidence.UNKNOWN);
}
