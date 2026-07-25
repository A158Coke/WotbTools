package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 固定时间窗内的队形摘要。坐标只表达几何关系，不映射为地图地形名称。
 */
public record TeamFormationPhase(
        float startTime,
        float endTime,
        Vector3 centroid,
        float averageDispersion,
        int clusterCount,
        int observedMemberCount,
        DecodeConfidence confidence
) {
}
