package com.wotb.core.replay.timeline;

import com.wotb.core.replay.reconstruction.LifeState;

import java.util.List;

/**
 * BattleFrame 内一辆车在 battle-relative 时间 t 的完整状态（knowledge-world 视角）。
 * <p>identity/tank 展示信息（tankName/tankClass/tankTier/baseHp）来自 tankopedia
 * reference data，与回放原始事实分开；当前血量/位置/朝向只来自回放事件。</p>
 */
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
