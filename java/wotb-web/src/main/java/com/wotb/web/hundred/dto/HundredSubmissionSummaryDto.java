package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

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
    String rejectReasonText
) {
}
