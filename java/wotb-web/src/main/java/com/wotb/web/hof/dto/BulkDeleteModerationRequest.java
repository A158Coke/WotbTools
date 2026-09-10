package com.wotb.web.hof.dto;

import java.util.List;
import java.util.Objects;

/**
 * 百场 / 三环 submission 批量删除请求。
 *
 * <p>reason / reasonText 沿用各域单条删除已有的强制原因规则，本请求不做任何放宽。</p>
 */
public record BulkDeleteModerationRequest(List<Long> ids, String reason, String reasonText) {

    /** 单批上限：为无界的批量写入设硬边界。 */
    private static final int MAX_BULK_IDS = 100;

    /** 去重并剔除空值；超出单批上限 → 400 BULK_LIMIT_EXCEEDED。 */
    public List<Long> normalizedIds() {
        final List<Long> targets = ids == null ? List.of()
                : ids.stream().filter(Objects::nonNull).distinct().toList();
        if (targets.size() > MAX_BULK_IDS) {
            throw new IllegalArgumentException("BULK_LIMIT_EXCEEDED");
        }
        return targets;
    }
}
