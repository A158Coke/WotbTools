package com.wotb.web.boost.dto;

/** 创建打手请求。 */
public record CreateBoosterRequest(
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
