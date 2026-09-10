package com.wotb.web.hof.dto;

/**
 * 批量删除单条记录的结果。
 *
 * @param id 目标记录 ID
 * @param deleted 是否删除成功
 * @param errorCode 失败时的错误码（复用各域既有的公开错误码）；成功时为 null
 */
public record BulkDeleteItemResult(long id, boolean deleted, String errorCode) {
}
