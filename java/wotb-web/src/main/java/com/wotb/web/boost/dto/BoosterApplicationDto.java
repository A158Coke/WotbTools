package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

public record BoosterApplicationDto(
    Long id,
    String keycloakUserId,
    Long userProfileId,
    Long wotbAccountId,
    String wotbNickname,
    String wotbServer,
    String overallStatsImage,
    String vehicleStatsImage,
    String requestedLevel,
    String qq,
    String wechat,
    String availabilityTier,
    String dailyTimeWindow,
    String selfAssessment,
    String status,
    String adminNote,
    Long approvedBoosterId,
    String reviewedBy,
    OffsetDateTime reviewedAt,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
