package com.wotb.web.mark3.dto;

import java.util.List;
import java.util.Objects;

/** 三环批量删除请求；原因规则与单条删除保持一致。 */
public record BulkDeleteModerationRequest(List<Long> ids, String reason, String reasonText) {
    private static final int MAX_BULK_IDS = 100;

    /** 去重并剔除空值；超出单批上限时返回既有批量错误码。 */
    public List<Long> normalizedIds() {
        final List<Long> targets = ids == null ? List.of()
                : ids.stream().filter(Objects::nonNull).distinct().toList();
        if (targets.size() > MAX_BULK_IDS) {
            throw new IllegalArgumentException("BULK_LIMIT_EXCEEDED");
        }
        return targets;
    }
}
