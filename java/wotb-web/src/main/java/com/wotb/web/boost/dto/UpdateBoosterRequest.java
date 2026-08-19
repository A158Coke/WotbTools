package com.wotb.web.boost.dto;

/** 更新打手请求 — PATCH 语义，只更新非 null 字段。 */
public record UpdateBoosterRequest(
    String nickname,
    String level,
    String keycloakUserId,
    Boolean available,
    String status,
    String contactType,
    String contactValue,
    String specialties,
    String description
) {}
