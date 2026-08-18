package com.wotb.web.hof.dto;

import java.util.List;

/** 名人堂管理后台分页响应。 */
public record HofAdminPageDto(
    List<HofAdminRecordDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
