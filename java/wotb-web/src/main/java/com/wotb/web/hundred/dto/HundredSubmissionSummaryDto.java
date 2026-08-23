package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

/** 个人中心百场状态摘要（CURRENT / PENDING / REJECTED 共享）。 */
public record HundredSubmissionSummaryDto(
    Long id,
    long vehicleId,
    String vehicleName,
    String status,
    int claimedAverageDamage,
    int claimedBattleCount,
    Integer approvedAverageDamage,
    Integer approvedBattleCount,
    OffsetDateTime submittedAt,
    OffsetDateTime approvedAt,
    String rejectReason,
    String rejectReasonText,
    String verificationSource,
    Long officialTankBattleCount,
    Integer officialAverageDamage
) {
}
