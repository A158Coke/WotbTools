package com.wotb.core.replay.timeline;

import com.wotb.core.replay.reconstruction.Vector3;

/**
 * Frame 内一辆车的空间状态（含位置知识状态与溯源）。
 * <p>XYZ 允许进入 AI context 作为 supporting spatial evidence；主要战术语义仍是
 * 语义区域/九宫格/地形（见 FrameMapState 与 TimelineMapEnricher）。</p>
 */
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
