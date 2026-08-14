package com.wotb.core.replay.event;

/**
 * 争霸赛实时点数事件（Packet Type 8 EntityMethod / subtype 48 updateArena2 的 root field 12）。
 * <p>协议（5 个真实回放已 PROVEN，跨版本字段稳定性暂记 PARTIAL，见 docs/research/replay/protocol.md）：
 * root field 12 为重复的 protobuf 消息，每条直接携带 field 1 = team（1/2）、
 * field 2 = 当前争霸点数（整数；点数会随击毁 ±40 与自然产分升降，非单调）。
 * 只消费回放真实广播，绝不按游戏规则推算点数；结构不完整或 team/points 非法时不产出事件。</p>
 *
 * @param sequence   事件顺序号
 * @param timestamp  时间戳
 * @param packetType 来源原始 packet type
 * @param confidence 解码置信度（结构完整且 team∈{1,2}、points 合法 → EXACT）
 * @param team       队伍（1/2）
 * @param points     该队当前争霸点数
 */
public record SupremacyPointsChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int team,
        int points
) implements ReplayEvent {
}
