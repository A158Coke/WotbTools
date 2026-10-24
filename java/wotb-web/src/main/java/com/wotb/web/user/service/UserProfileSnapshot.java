package com.wotb.web.user.service;

import java.time.OffsetDateTime;

/** User-domain profile values exposed to other domains without exposing the JPA entity. */
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
