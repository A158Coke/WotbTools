package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import java.util.List;

public record TeamFormationCluster(
        float startTime,
        float endTime,
        CanonicalMapPosition centroid,
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
        if (centroid == null) {
            throw new IllegalArgumentException("centroid must not be null");
        }
        if (region < 0 || region > 9) {
            throw new IllegalArgumentException("Invalid region: " + region);
        }
        if (centroid.region() != region) {
            throw new IllegalArgumentException(
                    "Centroid region " + centroid.region() + " != declared region " + region);
        }
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
    }

    public int memberCount() {
        return memberIdentities.size();
    }

    public float centroidX() {
        return centroid.x();
    }

    public float centroidZ() {
        return centroid.z();
    }
}
