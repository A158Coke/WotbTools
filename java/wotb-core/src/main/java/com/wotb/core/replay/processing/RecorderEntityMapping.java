package com.wotb.core.replay.processing;

import com.wotb.core.replay.event.DecodeConfidence;

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
