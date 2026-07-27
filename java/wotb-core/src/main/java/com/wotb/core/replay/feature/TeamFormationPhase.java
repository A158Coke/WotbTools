package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

/**
 * 固定时间窗内的队形摘要。
 * <p>
 * {@code centroid} 是 <strong>canonical</strong>（500×500）坐标域的队形几何中心，已经过一次
 * raw→canonical 解析，下游禁止再次执行 raw 坐标映射。{@code clusterCount} 由
 * {@code clusters.size()} 派生。
 */
public record TeamFormationPhase(
        float startTime,
        float endTime,
        CanonicalMapPosition centroid,
        float averageDispersion,
        int observedMemberCount,
        DecodeConfidence confidence,
        List<TeamFormationCluster> clusters
) {
    public TeamFormationPhase {
        clusters = clusters == null ? List.of() : List.copyOf(clusters);
    }

    public int clusterCount() {
        return clusters.size();
    }
}
