package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import java.util.List;

/**
 * A single cluster within a formation phase.
 * Centroid is based on X/Z plane only (Y is excluded).
 * Region is determined by {@code TeamMapRegionResolver}.
 */
public record TeamFormationCluster(
        float startTime,
        float endTime,
        float centroidX,
        float centroidZ,
        int region,
        List<String> memberIdentities,
        int memberCount,
        DecodeConfidence confidence
) {
    public TeamFormationCluster {
        memberIdentities = List.copyOf(memberIdentities);
    }
}
