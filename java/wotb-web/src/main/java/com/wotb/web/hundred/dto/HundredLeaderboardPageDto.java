package com.wotb.web.hundred.dto;

import java.util.List;

/** 百场公开排行榜响应（vehicleId 为 null 时是全站或分类交集 Top 10）。 */
public record HundredLeaderboardPageDto(
    Long vehicleId,
    String vehicleName,
    List<HundredLeaderboardItemDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
