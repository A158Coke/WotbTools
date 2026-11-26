package com.wotb.core.replay.event;

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
