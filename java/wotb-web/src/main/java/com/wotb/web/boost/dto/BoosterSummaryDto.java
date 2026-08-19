package com.wotb.web.boost.dto;

/** 打手摘要 — 嵌套在分配 DTO 中，不暴露联系方式。 */
public record BoosterSummaryDto(
    Long id,
    String nickname,
    String level,
    String keycloakUserId,
    Boolean available,
    String status
) {}
