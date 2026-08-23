package com.wotb.web.hof.dto;

import java.time.OffsetDateTime;

/** 名人堂管理后台记录（供业务治理展示，不暴露内部战斗唯一键）。 */
public record HofAdminRecordDto(Long id, long accountId, String nickname,
                                long tankId, String tankName, String battleType,
                                int damageDealt, String mapName, String version,
                                OffsetDateTime battleTime, OffsetDateTime createdAt,
                                String replayHash, String replayFileName, Long replaySize,
                                String replayUploadedBy, boolean replayAvailable) {
}
