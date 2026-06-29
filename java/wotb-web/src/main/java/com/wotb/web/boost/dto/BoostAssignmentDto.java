package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/** 分配记录 DTO。 */
public record BoostAssignmentDto(
    Long id,
    Long requestId,
    BoosterSummaryDto booster,
    String status,
    String statusLabel,
    OffsetDateTime assignedAt,
    OffsetDateTime unassignedAt,
    String note,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
