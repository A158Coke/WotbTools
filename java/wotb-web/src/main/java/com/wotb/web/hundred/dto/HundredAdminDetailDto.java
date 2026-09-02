package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

/**
 * 管理后台百场详情（审核页一屏数据）。PENDING 可返回 proofScreenshot；
 * 终态文件证据已清理，普通用户无任何读取入口。
 */
public record HundredAdminDetailDto(
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
