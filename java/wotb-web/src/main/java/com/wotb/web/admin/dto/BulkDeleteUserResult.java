package com.wotb.web.admin.dto;

/**
 * 批量删除单个用户的结果。
 *
 * @param userId 目标 Keycloak sub
 * @param deleted 是否删除成功
 * @param errorCode 失败时的错误码（复用 {@code ErrorCode} 值）；成功时为 null
 */
public record BulkDeleteUserResult(String userId, boolean deleted, String errorCode) {
}
