package com.wotb.core.replay.event;

/**
 * Canonical Assault single-base capture transition for playback consumers.
 *
 * <p>The controlled protocol sample proves realtime progress through 100.
 * Capturing-team/ownership semantics are intentionally not synthesized from
 * raw wrapper8 fields until independently closed.</p>
 */
public record AssaultBaseStateTransition(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        Integer captureProgress
) implements ReplayEvent {

    public AssaultBaseStateTransition {
        if (captureProgress == null || captureProgress < 0 || captureProgress > 100) {
            throw new IllegalArgumentException("capture progress must be between 0 and 100");
        }
    }
}
