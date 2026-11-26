package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

public record HundredAdminListItemDto(
    Long id,
    String status,
    long vehicleId,
    String vehicleName,
    String wotbServer,
    long wotbAccountId,
    String nicknameSnapshot,
    Integer approvedAverageDamage,
    Long approvedBattleCount,
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
