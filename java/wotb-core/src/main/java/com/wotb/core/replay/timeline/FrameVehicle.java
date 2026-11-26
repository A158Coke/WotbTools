package com.wotb.core.replay.timeline;

import com.wotb.core.replay.reconstruction.LifeState;

import java.util.List;

public record FrameVehicle(
        int entityId,
        Long accountId,
        String nickname,
        Integer tankId,
        String tankName,
        String tankClass,
        Integer tankTier,
        Integer team,
        boolean friendly,
        LifeState lifeState,
        FrameHealth health,
        FramePosition position,
        FrameOrientation orientation,
        FrameMapState mapState,
        VehicleKnowledgeState knowledgeState,
        Double destroyedKnownAtSec,
        List<String> limitations
) {
}
