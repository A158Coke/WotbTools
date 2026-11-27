package com.wotb.web.hof.dto;

import java.util.List;

public record HallOfFamePageDto(
    List<HallOfFameRecordDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
