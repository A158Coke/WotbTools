package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

public record HundredAdminDetailDto(
    Long id,
    String status,
    long vehicleId,
    String vehicleName,
    String wotbServer,
    long wotbAccountId,
    String nicknameSnapshot,
    int claimedAverageDamage,
    int claimedBattleCount,
    Integer approvedAverageDamage,
    Integer approvedBattleCount,
    String proofScreenshot,
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
