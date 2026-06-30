package com.wotb.web.user.dto;

/** 用户资料响应。 */
public record UserProfileDto(
    Long id,
    String keycloakUserId,
    String displayName,
    String username,
    Long wotbAccountId,
    String wotbNickname,
    String wotbServer
) {}