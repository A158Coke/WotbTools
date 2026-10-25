package com.wotb.web.hundred.dto;

import java.util.List;

/** 百场批量删除逐条结果与汇总计数；允许 partial success。 */
public record BulkDeleteResultDto(int requested, int deleted, int failed, List<BulkDeleteItemResult> results) {
}
