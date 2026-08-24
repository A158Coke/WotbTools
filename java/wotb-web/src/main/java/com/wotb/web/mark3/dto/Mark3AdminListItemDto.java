package com.wotb.web.mark3.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** 管理后台三环列表行；截图仅详情接口按需返回。 */
public record Mark3AdminListItemDto(
        Long id,
        String status,
        long vehicleId,
        String vehicleName,
        long gameAccountIdSnapshot,
        String nicknameSnapshot,
        int claimedBattleCount,
        int claimedAverageDamage,
        BigDecimal claimedWinRate,
        Integer approvedBattleCount,
        Integer approvedAverageDamage,
        BigDecimal approvedWinRate,
        boolean replayParseOk,
        boolean replayGameIdMatch,
        boolean replayVehicleMatch,
        boolean replayDistinctBattles,
        OffsetDateTime submittedAt,
        OffsetDateTime approvedAt,
        String rejectReason,
        String deleteReason
) {
}
