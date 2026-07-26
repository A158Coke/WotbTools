package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import java.util.List;

/**
 * A single cluster within a formation phase.
 * Centroid is canonical 500×500 X/Z (Y excluded).
 * Region is derived from the canonical centroid via {@link MapRegionResolver}.
 * memberCount is derived from memberIdentities.size().
 */
public record TeamFormationCluster(
        float startTime,
        float endTime,
        float centroidX,
        float centroidZ,
        int region,
        List<String> memberIdentities,
        DecodeConfidence confidence
) {
    public TeamFormationCluster {
        if (memberIdentities == null) {
            throw new IllegalArgumentException("memberIdentities must not be null");
        }
        memberIdentities = List.copyOf(memberIdentities);
        for (final String id : memberIdentities) {
            if (id == null || id.isBlank()) {
                throw new IllegalArgumentException("memberIdentities contains null/blank");
            }
        }
        if (!Float.isFinite(startTime) || !Float.isFinite(endTime) || startTime > endTime) {
            throw new IllegalArgumentException("Invalid time range: " + startTime + "-" + endTime);
        }
        if (!Float.isFinite(centroidX) || !Float.isFinite(centroidZ)) {
            throw new IllegalArgumentException("Invalid centroid: " + centroidX + "," + centroidZ);
        }
        if (region < 0 || region > 9) {
            throw new IllegalArgumentException("Invalid region: " + region);
        }
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
    }

    public int memberCount() {
        return memberIdentities.size();
    }
}
