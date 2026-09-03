package com.wotb.core.replay.event;

/**
 * Wrapper12 realtime Supremacy base-state update.
 *
 * <p>The raw protocol fields are projected only after the wrapper/root shape is
 * verified: base index (field 1), owner team (field 2), capturing team
 * (field 3), progress (field 4), suspended/blocked flag (field 5), and the
 * recorder-local field 6 flag. Missing protobuf scalar fields retain their
 * semantic default as null so the canonical layer can distinguish an omitted
 * value from an invalid value.</p>
 */
public record SupremacyBaseStateChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int baseIndex,
        Integer ownerTeam,
        Integer capturingTeam,
        Integer captureProgress,
        boolean captureSuspended,
        Boolean recorderCaptureFlag6
) implements ReplayEvent {
}
