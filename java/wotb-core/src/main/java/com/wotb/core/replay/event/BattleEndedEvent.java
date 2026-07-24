package com.wotb.core.replay.event;

/**
 * 战斗结束事件（对应 Packet Type 14 Battle End）。
 * <p>
 * 设置 lifecycle，保存结束时间，尝试保存胜方。
 * 后续仍允许处理回放结束后的尾部事件包。
 * </p>
 *
 * @param sequence    事件顺序号
 * @param timestamp   时间戳
 * @param packetType  来源原始 packet type
 * @param confidence  解码置信度
 * @param winnerTeam  胜方队伍（可为 null）
 */
public record BattleEndedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        Integer winnerTeam
) implements ReplayEvent {
}
