package com.wotb.web.hundred.dto;

import java.util.List;

/** 百场公开排行榜分页响应（单车辆独立排行）。 */
public record HundredLeaderboardPageDto(
    long vehicleId,
    String vehicleName,
    List<HundredLeaderboardItemDto> items,
    int page,
    int size,
    long totalItems,
    int totalPages
) {
}
