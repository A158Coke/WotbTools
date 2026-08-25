package com.wotb.web.mark3.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

/** 管理后台三环详情；proofScreenshots 只在 PENDING 期间返回。 */
public record Mark3AdminDetailDto(
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
        List<String> proofScreenshots,
        boolean replayParseOk,
        boolean replayGameIdMatch,
        boolean replayVehicleMatch,
        boolean replayDistinctBattles,
        OffsetDateTime submittedAt,
        OffsetDateTime approvedAt,
        String approvedBy,
        OffsetDateTime rejectedAt,
        String rejectedBy,
        String rejectReason,
        String rejectReasonText,
        OffsetDateTime cancelledAt,
        OffsetDateTime deletedAt,
        String deletedBy,
        String deleteReason,
        String deleteReasonText
) {
}
