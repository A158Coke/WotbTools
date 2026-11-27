package com.wotb.web.hof.dto;

import java.time.OffsetDateTime;

public record HallOfFameRecordDto(Long id, Integer rank, long tankId, String tankName,
                                  String nickname, int damageDealt, String battleType,
                                  String mapName, String version, OffsetDateTime battleTime,
                                  OffsetDateTime createdAt, boolean replayAvailable) {
}
