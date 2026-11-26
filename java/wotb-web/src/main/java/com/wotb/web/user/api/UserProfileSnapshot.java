package com.wotb.web.user.api;

import java.time.OffsetDateTime;

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
