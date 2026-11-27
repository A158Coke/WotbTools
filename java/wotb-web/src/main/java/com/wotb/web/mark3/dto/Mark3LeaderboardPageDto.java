package com.wotb.web.mark3.dto;

import java.util.List;

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
