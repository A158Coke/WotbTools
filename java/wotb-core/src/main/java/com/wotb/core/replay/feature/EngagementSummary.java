package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.List;

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
    public EngagementSummary {
        if (!Float.isFinite(startTime) || startTime < 0) throw new IllegalArgumentException("startTime invalid: " + startTime);
        if (!Float.isFinite(endTime) || endTime < 0) throw new IllegalArgumentException("endTime invalid: " + endTime);
        if (startTime > endTime) throw new IllegalArgumentException("startTime > endTime: " + startTime + " > " + endTime);
        if (damageDealt < 0) throw new IllegalArgumentException("damageDealt negative: " + damageDealt);
        if (damageReceived < 0) throw new IllegalArgumentException("damageReceived negative: " + damageReceived);
        if (alliedAccountIds == null) throw new IllegalArgumentException("alliedAccountIds must not be null");
        if (enemyAccountIds == null) throw new IllegalArgumentException("enemyAccountIds must not be null");
        if (outcome == null) throw new IllegalArgumentException("outcome must not be null");
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
        alliedAccountIds = List.copyOf(alliedAccountIds);
        enemyAccountIds = List.copyOf(enemyAccountIds);
    }
}
