package com.wotb.web.hof.dto;

import java.time.OffsetDateTime;

public record HofAdminAuditDto(Long id, String action, long recordId, String arenaId, long accountId,
                               String nickname, long tankId, String tankName, int damageDealt,
                               String battleType, Integer arenaBonusType, String replayHash,
                               String adminKeycloakUserId, String adminUsername,
                               OffsetDateTime createdAt) {
}
