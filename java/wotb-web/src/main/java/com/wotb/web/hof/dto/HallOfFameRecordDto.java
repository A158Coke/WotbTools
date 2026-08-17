package com.wotb.web.hof.dto;

import java.time.OffsetDateTime;

/**
 * 名人堂公开记录 (API 纯英文 key)。公开边界：不暴露 accountId / arenaId / replayHash / uploadedBy
 * 等内部数据；replayAvailable 由 DB metadata 推导，不做磁盘探测。rank 为当前 filter 上下文位置排名
 * （仅公开列表上下文中非 null）。
 */
public record HallOfFameRecordDto(Long id, Integer rank, long tankId, String tankName,
                                  String nickname, int damageDealt, String battleType,
                                  String mapName, String version, OffsetDateTime battleTime,
                                  OffsetDateTime createdAt, boolean replayAvailable) {
}
