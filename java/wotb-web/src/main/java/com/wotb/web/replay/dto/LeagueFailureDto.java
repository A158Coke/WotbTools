package com.wotb.web.replay.dto;

/** 一场训练赛/联赛回放的校验失败（稳定错误码；前端三语映射文案）。 */
public record LeagueFailureDto(String fileName, String arenaId, String code) {
}
