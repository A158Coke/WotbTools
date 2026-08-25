package com.wotb.web.mark3.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** 三环公开排行榜行；只输出审核通过的 approved 快照。 */
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
