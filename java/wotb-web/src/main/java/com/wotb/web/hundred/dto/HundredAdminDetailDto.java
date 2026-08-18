package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

/**
 * 管理后台百场详情（审核页一屏数据）。proofScreenshot 只在 PENDING 时返回
 * （终态事务内已清空；即便历史残留也不对外，普通用户无任何读取入口）。
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
    OffsetDateTime deletedAt,
    String deletedBy,
    String deleteReason,
    String deleteReasonText
) {
}
