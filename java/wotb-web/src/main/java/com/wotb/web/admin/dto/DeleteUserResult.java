package com.wotb.web.admin.dto;

/**
 * 删除单个用户的结果（请求体是一个 id 列表，因此每个 id 都有一条结果）。
 *
 * @param userId 目标 Keycloak sub
 * @param deleted 是否删除成功
 * @param errorCode 失败时的错误码（复用 {@code ErrorCode} 值）；成功时为 null
 */
public record DeleteUserResult(String userId, boolean deleted, String errorCode) {
}
