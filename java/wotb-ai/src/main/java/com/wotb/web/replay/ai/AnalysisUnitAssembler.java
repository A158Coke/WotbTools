package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.Map;

/**
 * 分析单元映射的唯一实现。
 * <p>负责查找录像者 entity 映射，供 Player/Team 编排复用。纯映射，不含业务判断；
 * 不发送 HTTP、不构建 Prompt。</p>
 */
public final class AnalysisUnitAssembler {

    private AnalysisUnitAssembler() {
    }

    /**
     * 查找录像者在重建结果中的 entity 映射。
     */
    public static RecorderEntityMapping findRecorder(final Battle battle,
                                                      final ReplayReconstruction reconstruction) {
        if (reconstruction != null) {
            final Map<Long, Integer> entityByAccount = new java.util.HashMap<>();
            for (final var e : reconstruction.events()) {
                if (e instanceof ParticipantMappingEvent pm) {
                    entityByAccount.put(pm.accountId(), pm.entityId());
                }
            }
            for (final var p : reconstruction.participants()) {
                if (p.recorder()) {
                    final Integer eid = entityByAccount.get(p.accountId());
                    return new RecorderEntityMapping(p.accountId(), p.tankId(),
                            eid, p.nickname(), p.team(), p.tankId(),
                            eid != null ? DecodeConfidence.EXACT : DecodeConfidence.INFERRED);
                }
            }
        }
        if (battle != null && battle.recorder != null)
            return new RecorderEntityMapping(null, null, null,
                    battle.recorder, 0, 0, DecodeConfidence.INFERRED);
        return RecorderEntityMapping.unresolved();
    }
}
