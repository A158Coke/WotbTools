package com.wotb.web.hundred.dto;

/** 百场批量删除单条结果。 */
public record BulkDeleteItemResult(long id, boolean deleted, String errorCode) {
}
