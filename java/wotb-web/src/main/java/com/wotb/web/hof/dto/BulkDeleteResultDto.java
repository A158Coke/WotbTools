package com.wotb.web.hof.dto;

import java.util.List;

/**
 * 名人堂批量删除响应：逐条结果 + 汇总计数。
 * 允许 partial success——单条失败不影响其他记录已完成的删除。
 */
public record BulkDeleteResultDto(
        int requested,
        int deleted,
        int failed,
        List<BulkDeleteItemResult> results
) {
}
