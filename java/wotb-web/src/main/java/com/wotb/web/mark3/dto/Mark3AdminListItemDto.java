package com.wotb.web.mark3.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record Mark3AdminListItemDto(
        Long id,
        String status,
        long vehicleId,
        String vehicleName,
        String wotbServer,
        long wotbAccountId,
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
