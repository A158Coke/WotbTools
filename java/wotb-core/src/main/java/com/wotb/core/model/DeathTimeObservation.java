package com.wotb.core.model;

/**
 * Reconstruction-layer observation of a player's final live death time.
 *
 * <p>This is deliberately separate from {@link PlayerResult}: settlement facts remain immutable
 * with respect to replay reconstruction, while consumers that have a reconstruction can opt into
 * the more precise live observation.</p>
 *
 * @param source the evidence source for the observation
 * @param timeSec battle-relative death time in seconds
 */
public record DeathTimeObservation(DeathTimeSource source, double timeSec) {
    public DeathTimeObservation {
        if (source == null) {
            throw new IllegalArgumentException("source must not be null");
        }
        if (!Double.isFinite(timeSec) || timeSec <= 0) {
            throw new IllegalArgumentException("timeSec must be finite and > 0");
        }
    }
}
