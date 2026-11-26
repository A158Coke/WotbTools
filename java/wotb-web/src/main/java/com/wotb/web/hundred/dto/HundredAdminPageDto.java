package com.wotb.web.hundred.dto;

import java.util.List;

public record HundredAdminPageDto(
    List<HundredAdminListItemDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
