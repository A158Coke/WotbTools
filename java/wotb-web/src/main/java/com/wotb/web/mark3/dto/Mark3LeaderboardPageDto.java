package com.wotb.web.mark3.dto;

import java.util.List;

/** 三环公开排行榜响应；未指定车辆时返回当前筛选上下文的固定 Top 10。 */
public record Mark3LeaderboardPageDto(
        Long vehicleId,
        String vehicleName,
        List<Mark3LeaderboardItemDto> items,
        int page,
        int size,
        long totalItems,
        int totalPages
) {
}
