package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

public record HundredLeaderboardItemDto(
    Long id,
    Integer rank,
    long vehicleId,
    String vehicleName,
    String nickname,
    int approvedAverageDamage,
    int approvedBattleCount,
    OffsetDateTime approvedAt
) {
}
