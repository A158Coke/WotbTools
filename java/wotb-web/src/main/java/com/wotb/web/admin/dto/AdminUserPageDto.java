package com.wotb.web.admin.dto;

import java.util.List;

public record AdminUserPageDto(
        List<AdminUserListItemDto> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
