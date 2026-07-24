package com.wotb.core.replay.reconstruction;

/**
 * 回放元数据，来自 meta.json + battle_results.dat 的摘要信息。
 *
 * @param arenaId        竞技场 ID
 * @param mapName        地图名
 * @param gameVersion    游戏版本
 * @param clientVersion  客户端版本
 * @param arenaBonusType 模式类型
 * @param recorder       录像者昵称
 * @param recorderVehicle 录像者车辆名
 * @param battleDurationSec 战斗时长（来自 meta.json，可能不准确）
 * @param startTime      战斗开始时间戳
 */
public record ReplayMetadata(
        String arenaId,
        String mapName,
        String gameVersion,
        String clientVersion,
        Integer arenaBonusType,
        String recorder,
        String recorderVehicle,
        Double battleDurationSec,
        Long startTime
) {
}
