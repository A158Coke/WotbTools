package com.wotb.web.admin.dto;

import java.util.List;

/** 管理后台用户列表分页响应；{@code totalItems} / {@code totalPages} 为权威计数，不做内存伪造分页。 */
public record AdminUserPageDto(
        List<AdminUserListItemDto> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
