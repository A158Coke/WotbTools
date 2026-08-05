package com.wotb.web.user.dto;

import java.time.OffsetDateTime;

/** 用户资料响应。 */
public record UserProfileDto(
    Long id,
    String keycloakUserId,
    String displayName,
    String username,
    Long wotbAccountId,
    String wotbNickname,
    String wotbServer,
    String wotbAccountSource,
    OffsetDateTime wotbAccountVerifiedAt
) {}
