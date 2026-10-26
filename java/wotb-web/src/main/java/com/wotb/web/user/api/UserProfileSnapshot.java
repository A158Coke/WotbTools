package com.wotb.web.user.api;

import java.time.OffsetDateTime;

/** 用户模块对外提供的资料快照，不暴露 JPA 实体。 */
public record UserProfileSnapshot(
        Long id,
        String keycloakUserId,
        String displayName,
        Long wotbAccountId,
        String wotbNickname,
        String wotbServer,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {
}
