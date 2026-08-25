package com.wotb.web.mark3.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** 当前用户三环申请的摘要；不返回截图、回放、游戏账号 ID。 */
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
