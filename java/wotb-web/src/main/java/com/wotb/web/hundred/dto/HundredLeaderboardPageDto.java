package com.wotb.web.hundred.dto;

import java.util.List;

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
