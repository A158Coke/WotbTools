package com.wotb.core.replay.event;

/**
 * Reconstructed full-state Supremacy base transition for playback consumers.
 * Every transition carries the complete state needed by a renderer; omitted
 * raw fields have already been resolved by the backend reconstructor.
 */
public record SupremacyBaseStateTransition(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        SupremacyBaseId baseId,
        Integer ownerTeam,
        Integer capturingTeam,
        Integer captureProgress
) implements ReplayEvent {

    public SupremacyBaseStateTransition {
        if (baseId == null) {
            throw new IllegalArgumentException("baseId must not be null");
        }
        if (!validTeam(ownerTeam) || !validTeam(capturingTeam)) {
            throw new IllegalArgumentException("base teams must be null, 1, or 2");
        }
        if (captureProgress != null && (captureProgress < 0 || captureProgress > 99)) {
            throw new IllegalArgumentException("capture progress must be between 0 and 99");
        }
    }

    private static boolean validTeam(final Integer team) {
        return team == null || team == 1 || team == 2;
    }
}
