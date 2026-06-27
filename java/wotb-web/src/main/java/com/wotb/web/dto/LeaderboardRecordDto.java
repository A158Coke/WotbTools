package com.wotb.web.dto;

import java.time.OffsetDateTime;

/** 排行榜记录 (API 纯英文 key, 不含中文)。 */
public record LeaderboardRecordDto(Long id, String arenaId, long tankId, String tankName,
                                   long accountId, String nickname, int damageDealt,
                                   String mapName, String version, OffsetDateTime battleTime,
                                   OffsetDateTime createdAt) {
}
