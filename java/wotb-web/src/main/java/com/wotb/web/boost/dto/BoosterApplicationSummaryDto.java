package com.wotb.web.boost.dto;

import java.time.OffsetDateTime;

/**
 * Lightweight booster application data for list and mutation responses. Image
 * payloads and extended applicant details are available only from the detail endpoint.
 */
public record BoosterApplicationSummaryDto(
    Long id,
    Long wotbAccountId,
    String wotbNickname,
    String requestedLevel,
    String qq,
    String availabilityTier,
    String status,
    String adminNote,
    Long approvedBoosterId,
    OffsetDateTime createdAt
) {}
