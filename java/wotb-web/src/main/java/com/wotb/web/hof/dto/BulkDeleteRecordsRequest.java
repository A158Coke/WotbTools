package com.wotb.web.hof.dto;

import java.util.List;
import java.util.Objects;

/**
 * 单场名人堂记录批量删除请求。
 *
 * <p>单场删除在本域是 hard delete 且没有 delete reason 语义，因此本请求刻意不携带
 * reason 字段——不为了和百场/三环统一形状而给单场新造一套规则。</p>
 */
public record BulkDeleteRecordsRequest(List<Long> ids) {

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
