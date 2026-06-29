package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/** 管理员侧需求 DTO。 */
public record AdminBoostRequestDto(
    Long id,
    String requesterUserId,
    Long wotbAccountId,
    Long playerAccountId,
    String playerNickname,
    String region,
    String regionLabel,
    String requestType,
    String requestTypeLabel,
    String targetDescription,
    String budgetRange,
    String contactType,
    String contactValue,
    String availableTime,
    String remark,
    String status,
    String statusLabel,
    String adminNote,
    BoostAssignmentDto currentAssignment,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
