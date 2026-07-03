package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/** 打手信息 DTO。 */
public record BoosterDto(
    Long id,
    String nickname,
    String level,
    String levelLabel,
    String keycloakUserId,
    Boolean available,
    String status,
    String statusLabel,
    String contactType,
    String contactValue,
    String specialties,
    String description,
    Integer activeAssignmentCount,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
