package com.wotb.core.replay.event;

/**
 * Type31 recorder arcade gun-marker / aiming-circle size sample。
 *
 * <p>PR147 current 11.19 wire = exactly one float32. The scalar is the recorded marker-size
 * state itself; units are intentionally not renamed to pixels/radians and it is not penetration probability.</p>
 */
public record GunMarkerSizeEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        float markerSizeRaw
) implements ReplayEvent {
}
