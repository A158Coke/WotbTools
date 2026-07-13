package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/** 玩家侧需求 DTO — 不暴露 adminNote、完整联系方式、assignment history。 */
public record BoostRequestDto(
    Long id,
    Long playerAccountId,
    String playerNickname,
    String region,
    String requestType,
    String targetDescription,
    String budgetRange,
    String contactType,
    String contactValueMasked,
    String availableTime,
    String remark,
    String status,
    Boolean assigned,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
