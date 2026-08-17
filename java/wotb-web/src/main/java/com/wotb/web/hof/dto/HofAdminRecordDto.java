package com.wotb.web.hof.dto;

import java.time.OffsetDateTime;

/** 名人堂管理后台记录（admin 全量 metadata，含内部字段）。 */
public record HofAdminRecordDto(Long id, String arenaId, long accountId, String nickname,
                                long tankId, String tankName, String battleType, Integer arenaBonusType,
                                int damageDealt, String mapName, String version,
                                OffsetDateTime battleTime, OffsetDateTime createdAt,
                                String replayHash, String replayFileName, Long replaySize,
                                String replayUploadedBy, boolean replayAvailable) {
}
