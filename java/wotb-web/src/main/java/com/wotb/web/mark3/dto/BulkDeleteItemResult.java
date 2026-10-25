package com.wotb.web.mark3.dto;

/** 三环批量删除单条结果。 */
public record BulkDeleteItemResult(long id, boolean deleted, String errorCode) {
}
