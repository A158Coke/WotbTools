package com.wotb.core.processing;

import com.wotb.core.replay.event.DecodeConfidence;
import org.springframework.util.StringUtils;

/**
 * 一个回放实体映射到的参战玩家身份。
 */
public record TeamEntityIdentity(
        int entityId,
        long accountId,
        String nickname,
        long tankId,
        String tankName,
        int team,
        DecodeConfidence confidence
) {

    public TeamEntityIdentity {
        confidence = confidence == null ? DecodeConfidence.UNKNOWN : confidence;
    }

    public boolean usable() {
        return entityId > 0 && team > 0
                && (accountId > 0 || StringUtils.hasText(nickname))
                && (confidence == DecodeConfidence.EXACT
                || confidence == DecodeConfidence.INFERRED);
    }
}
