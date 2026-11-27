package com.wotb.web.mark3.dto;

import java.time.OffsetDateTime;

public record Mark3ReplayEvidenceDto(
        Long id,
        int slot,
        String originalFilename,
        long fileSize,
        String arenaId,
        String sha256,
        OffsetDateTime createdAt
) {
}
