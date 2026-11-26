package com.wotb.web.mark3.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record Mark3LeaderboardItemDto(
        Long id,
        Integer rank,
        long vehicleId,
        String vehicleName,
        String nickname,
        int approvedBattleCount,
        int approvedAverageDamage,
        BigDecimal approvedWinRate,
        OffsetDateTime approvedAt
) {
}
