package com.wotb.web.hof.dto;

import java.util.List;

public record HofAdminPageDto(
    List<HofAdminRecordDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
