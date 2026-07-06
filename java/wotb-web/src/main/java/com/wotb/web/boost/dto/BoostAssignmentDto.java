package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/** 分配记录 DTO（含请求摘要）。 */
public record BoostAssignmentDto(
    Long id,
    Long requestId,
    BoosterSummaryDto booster,
    String status,
    String statusLabel,
    String requestTypeLabel,
    String targetDescription,
    String requestStatus,
    String requestStatusLabel,
    String contactType,
    String contactValue,
    String availableTime,
    String playerNickname,
    Long playerAccountId,
    String budgetRange,
    String remark,
    OffsetDateTime assignedAt,
    OffsetDateTime unassignedAt,
    String note,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
