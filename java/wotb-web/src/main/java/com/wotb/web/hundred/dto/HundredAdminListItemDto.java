package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

/**
 * 管理后台百场列表行（不含 proof 截图，详情接口按需返回）。
 */
public record HundredAdminListItemDto(
        Long id,
        String status,
        long vehicleId,
        String vehicleName,
        long gameAccountIdSnapshot,
        String nicknameSnapshot,
        int claimedAverageDamage,
        int claimedBattleCount,
        Integer approvedAverageDamage,
        Integer approvedBattleCount,
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
