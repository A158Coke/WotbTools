package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import java.util.List;
import java.util.stream.Collectors;

/**
 * A single cluster within a formation phase.
 * Centroid is based on X/Z plane only (Y is excluded).
 * Region is determined by {@link TeamMapRegionResolver}.
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
        // Defensive copy
        memberIdentities = memberIdentities == null
                ? List.of() : List.copyOf(memberIdentities);

        // Validate time range
        if (!Float.isFinite(startTime) || !Float.isFinite(endTime)
                || startTime > endTime) {
            throw new IllegalArgumentException(
                    "Invalid cluster time range: " + startTime + " - " + endTime);
        }

        // Validate centroid
        if (!Float.isFinite(centroidX) || !Float.isFinite(centroidZ)) {
            throw new IllegalArgumentException(
                    "Invalid centroid: " + centroidX + "," + centroidZ);
        }

        // Validate region: 0 (UNKNOWN) or 1-9
        if (region < 0 || region > 9) {
            throw new IllegalArgumentException("Invalid region: " + region);
        }

        // Validate member count matches identities
        final int effectiveCount = (int) memberIdentities.stream()
                .filter(id -> id != null && !id.isEmpty())
                .count();
        if (memberCount != effectiveCount) {
            throw new IllegalArgumentException(
                    "memberCount " + memberCount + " != effective identities " + effectiveCount);
        }

        // Confidence null → UNKNOWN
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
    }
}
