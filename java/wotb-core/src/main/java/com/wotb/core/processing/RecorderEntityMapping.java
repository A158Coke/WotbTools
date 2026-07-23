package com.wotb.core.processing;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 录像者完整实体映射。
 * recorder → accountId → vehicleId → entityId
 */
public record RecorderEntityMapping(
        Long accountId,
        Integer vehicleId,
        Integer entityId,
        String nickname,
        Integer team,
        Integer tankId,
        DecodeConfidence confidence
) {

    public boolean resolved() {
        return entityId != null && confidence != DecodeConfidence.UNKNOWN;
    }

    public static RecorderEntityMapping unresolved() {
        return new RecorderEntityMapping(null, null, null, null, null, null, DecodeConfidence.UNKNOWN);
    }
}
