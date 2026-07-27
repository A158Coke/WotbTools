package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.List;

public record TeamFormationPhase(
        float startTime,
        float endTime,
        Vector3 centroid,
        float averageDispersion,
        int observedMemberCount,
        DecodeConfidence confidence,
        List<TeamFormationCluster> clusters
) {
    public TeamFormationPhase {
        if (!Float.isFinite(startTime) || startTime < 0)
            throw new IllegalArgumentException("startTime invalid: " + startTime);
        if (!Float.isFinite(endTime) || endTime < 0)
            throw new IllegalArgumentException("endTime invalid: " + endTime);
        if (startTime > endTime)
            throw new IllegalArgumentException("startTime > endTime: " + startTime + " > " + endTime);
        if (centroid == null) throw new IllegalArgumentException("centroid must not be null");
        if (!Float.isFinite(averageDispersion) || averageDispersion < 0)
            throw new IllegalArgumentException("averageDispersion invalid: " + averageDispersion);
        if (observedMemberCount < 0)
            throw new IllegalArgumentException("observedMemberCount negative: " + observedMemberCount);
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
        clusters = clusters == null ? List.of() : List.copyOf(clusters);
        for (final TeamFormationCluster c : clusters) {
            if (c == null) throw new IllegalArgumentException("cluster must not be null");
            if (c.startTime() < startTime || c.endTime() > endTime)
                throw new IllegalArgumentException("cluster time [" + c.startTime() + "," + c.endTime()
                        + "] outside phase [" + startTime + "," + endTime + "]");
        }
    }

    public int clusterCount() {
        return clusters.size();
    }
}
