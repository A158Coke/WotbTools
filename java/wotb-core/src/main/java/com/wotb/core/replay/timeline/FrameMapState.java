package com.wotb.core.replay.timeline;

import java.util.List;

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
