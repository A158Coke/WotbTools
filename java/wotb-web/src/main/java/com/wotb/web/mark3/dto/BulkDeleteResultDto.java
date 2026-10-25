package com.wotb.web.mark3.dto;

import java.util.List;

/** 三环批量删除逐条结果与汇总计数；允许 partial success。 */
public record BulkDeleteResultDto(int requested, int deleted, int failed, List<BulkDeleteItemResult> results) {
}
