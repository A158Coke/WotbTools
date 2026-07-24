package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.List;

/**
 * 交火段摘要 —— 一段连续交火过程的压缩信息。
 */
public record EngagementSummary(
        float startTime,
        float endTime,
        List<Long> alliedAccountIds,
        List<Long> enemyAccountIds,
        int damageDealt,
        int damageReceived,
        Vector3 recorderStartPosition,
        Vector3 recorderEndPosition,
        EngagementOutcome outcome,
        DecodeConfidence confidence
) {
}
