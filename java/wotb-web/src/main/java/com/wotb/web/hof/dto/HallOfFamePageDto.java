package com.wotb.web.hof.dto;

import java.util.List;

/**
 * 名人堂公开分页响应。
 */
public record HallOfFamePageDto(
        List<HallOfFameRecordDto> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
