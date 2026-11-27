package com.wotb.web.hof.dto;

import java.time.OffsetDateTime;

public record HofAdminRecordDto(Long id, long accountId, String nickname,
                                long tankId, String tankName, String battleType,
                                int damageDealt, String mapName, String version,
                                OffsetDateTime battleTime, OffsetDateTime createdAt,
                                String replayHash, String replayFileName, Long replaySize,
                                String replayUploadedBy, boolean replayAvailable) {
}
