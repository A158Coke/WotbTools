package com.wotb.web.dto;

import java.util.List;

/** 排行榜分页响应。 */
public record LeaderboardPageDto(
    List<LeaderboardRecordDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {}
