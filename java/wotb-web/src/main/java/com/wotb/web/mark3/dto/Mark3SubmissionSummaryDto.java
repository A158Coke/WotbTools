package com.wotb.web.mark3.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record Mark3SubmissionSummaryDto(
        Long id,
        long vehicleId,
        String vehicleName,
        String status,
        int claimedBattleCount,
        int claimedAverageDamage,
        BigDecimal claimedWinRate,
        Integer approvedBattleCount,
        Integer approvedAverageDamage,
        BigDecimal approvedWinRate,
        OffsetDateTime submittedAt,
        OffsetDateTime approvedAt,
        String rejectReason,
        String rejectReasonText
) {
}
