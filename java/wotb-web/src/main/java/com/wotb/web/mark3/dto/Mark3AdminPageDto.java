package com.wotb.web.mark3.dto;

import java.util.List;

/** 管理后台三环分页响应。 */
public record Mark3AdminPageDto(
        List<Mark3AdminListItemDto> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
