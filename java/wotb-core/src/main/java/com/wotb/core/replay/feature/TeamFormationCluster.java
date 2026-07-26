package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import java.util.HashSet;
import java.util.List;

public record TeamFormationCluster(
        float startTime,
        float endTime,
        CanonicalMapPosition centroid,
        MapCoordinateResolution.Status centroidStatus,
        int region,
        int clampedMemberPositionCount,
        List<String> memberIdentities,
        DecodeConfidence confidence
) {
    public TeamFormationCluster {
        if (memberIdentities == null) {
            throw new IllegalArgumentException("memberIdentities must not be null");
        }
        if (memberIdentities.isEmpty()) {
            throw new IllegalArgumentException("memberIdentities must not be empty");
        }
        memberIdentities = List.copyOf(memberIdentities);
        final HashSet<String> uniqueIds = new HashSet<>();
        for (final String id : memberIdentities) {
            if (id == null || id.isBlank()) {
                throw new IllegalArgumentException("memberIdentities contains null/blank");
            }
            if (!uniqueIds.add(id)) {
                throw new IllegalArgumentException("memberIdentities contains duplicate: " + id);
            }
        }
        if (!Float.isFinite(startTime) || !Float.isFinite(endTime) || startTime > endTime) {
            throw new IllegalArgumentException("Invalid time range: " + startTime + "-" + endTime);
        }
        if (centroid == null) {
            throw new IllegalArgumentException("centroid must not be null");
        }
        if (centroidStatus == null) {
            throw new IllegalArgumentException("centroidStatus must not be null");
        }
        if (centroidStatus == MapCoordinateResolution.Status.INVALID) {
            throw new IllegalArgumentException("centroidStatus must not be INVALID");
        }
        if (region < 1 || region > 9) {
            throw new IllegalArgumentException("Invalid region: " + region);
        }
        if (centroid.region() != region) {
            throw new IllegalArgumentException(
                    "Centroid region " + centroid.region() + " != declared region " + region);
        }
        if (clampedMemberPositionCount < 0) {
            throw new IllegalArgumentException("clampedMemberPositionCount must not be negative");
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
