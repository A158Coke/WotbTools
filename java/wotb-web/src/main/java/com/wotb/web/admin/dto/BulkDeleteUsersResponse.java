package com.wotb.web.admin.dto;

import java.util.List;

/**
 * 批量删除用户响应：逐用户结果 + 汇总计数。
 * 允许 partial success——单个用户失败不影响其他用户已完成的删除。
 */
public record BulkDeleteUsersResponse(
        int requested,
        int deleted,
        int failed,
        List<BulkDeleteUserResult> results
) {
}
