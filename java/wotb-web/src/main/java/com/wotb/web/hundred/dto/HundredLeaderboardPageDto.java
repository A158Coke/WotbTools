package com.wotb.web.hundred.dto;

import java.util.List;

/** 百场公开排行榜分页响应（vehicleId 为 null 时是默认全局前十）。 */
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
