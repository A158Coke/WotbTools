package com.wotb.core.replay.reconstruction;

/**
 * 战斗参与者信息。
 *
 * @param accountId  账号 ID
 * @param nickname   玩家昵称
 * @param team       队伍（1 或 2）
 * @param tankId     坦克 ID
 * @param tankCode   坦克代号
 * @param recorder   是否为录像者
 */
public record BattleParticipant(
        long accountId,
        String nickname,
        int team,
        int tankId,
        String tankCode,
        boolean recorder
) {
}
