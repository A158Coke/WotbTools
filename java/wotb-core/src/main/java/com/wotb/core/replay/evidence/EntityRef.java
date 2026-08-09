package com.wotb.core.replay.evidence;

import org.springframework.util.StringUtils;

/**
 * 证据关联的实体引用。字段可空表示未知，但 {@code label} 始终非空（用于 Prompt 渲染）。
 */
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
