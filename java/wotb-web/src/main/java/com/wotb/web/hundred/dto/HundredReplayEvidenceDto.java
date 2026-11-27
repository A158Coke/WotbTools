package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

public record HundredReplayEvidenceDto(
    Long id,
    int slot,
    String originalFilename,
    long fileSize,
    String arenaId,
    String sha256,
    OffsetDateTime createdAt
) {
}
