package com.wotb.core.replay.timeline;

import java.util.List;

/**
 * Frame 内一辆车的地图语义 enrich 结果（确定性，复用 common/map-semantics）。
 * <p>边界：只表达「该格含硬掩体/该位置较高/该区域有建筑」这类几何/语义证据，
 * 禁止声称 exact LOS / 具体障碍挡炮 / hull-down（docs/current-plan.md §16.2）。
 * 数据缺失时字段为 null / 空列表，绝不编造。</p>
 */
public record FrameMapState(
        Integer gridRegion,
        String areaId,
        List<String> areaLabels,
        List<String> semanticTags,
        Float elevationM,
        Float slopeDeg,
        String terrainClass,
        Boolean hardCoverZone,
        Boolean softCoverZone,
        Boolean vegetationZone,
        Boolean ridgeCandidate,
        Boolean openGroundCandidate,
        String confidence
) {
    public static final FrameMapState UNKNOWN = new FrameMapState(
            null, null, List.of(), List.of(), null, null, null,
            null, null, null, null, null, null);
}
