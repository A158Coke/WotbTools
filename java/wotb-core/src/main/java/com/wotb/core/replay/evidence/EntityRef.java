package com.wotb.core.replay.evidence;

import org.springframework.util.StringUtils;

public record EntityRef(
        Integer entityId,
        Long accountId,
        Integer team,
        Integer tankId,
        String label
) {
    public EntityRef {
        if (!StringUtils.hasText(label)) {
            label = entityId != null ? "E" + entityId : "UNKNOWN";
        }
    }
}
