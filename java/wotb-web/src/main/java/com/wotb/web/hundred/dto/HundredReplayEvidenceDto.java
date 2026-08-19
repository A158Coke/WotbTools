package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

/**
 * 百场回放审核证据 metadata（admin-only；不包含文件内容，下载走独立端点）。
 * sha256 仅供 admin debug；originalFilename 由服务端存储时清洗（basename + 限长），
 * 仅用于展示 / Content-Disposition。
 */
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
