package com.wotb.web.boost.dto;

public record CreateBoosterApplicationRequest(
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
    String selfAssessment
) {}
