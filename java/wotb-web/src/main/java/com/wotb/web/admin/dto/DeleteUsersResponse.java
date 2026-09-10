package com.wotb.web.admin.dto;

import java.util.List;

/**
 * 删除用户响应：逐用户结果 + 汇总计数。
 *
 * <p>请求体是一个 Keycloak sub 列表（删除单个用户即长度为 1 的列表），因此响应始终是逐用户结果，
 * 并允许 partial success——某个用户失败不影响其他用户已完成的删除。</p>
 */
public record DeleteUsersResponse(
        int requested,
        int deleted,
        int failed,
        List<DeleteUserResult> results
) {
}
