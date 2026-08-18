package com.wotb.web.hundred.dto;

import java.util.List;

/** 管理后台百场分页响应。 */
public record HundredAdminPageDto(
    List<HundredAdminListItemDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
