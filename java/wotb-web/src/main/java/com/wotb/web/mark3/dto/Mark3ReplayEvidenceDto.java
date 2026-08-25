package com.wotb.web.mark3.dto;

import java.time.OffsetDateTime;

/** 三环回放审核 evidence metadata（admin-only，不含文件内容）。 */
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
