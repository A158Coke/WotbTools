package com.wotb.core.replay.event;

/**
 * 录像者瞄准/瞄准状态快照事件（Avatar-targeted method36 protobuf）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/avatar-method36-targeting-info.md）：
 * <ul>
 *   <li>root.field1 = turret/gun relative yaw（PROVEN）</li>
 *   <li>root.field2 = gun pitch（PROVEN）</li>
 *   <li>root.field3 = max horizontal angular speed rad/s（PROVEN controlled）</li>
 *   <li>root.field4 = max vertical angular speed rad/s（PROVEN controlled）</li>
 *   <li>root.field5 = aiming-time physical scalar（PROVEN physical role）</li>
 *   <li>field6.field1 = dynamic gun dispersion/bloom scalar（PROVEN physical role）</li>
 * </ul>
 * 74-byte 初始化变体缺少动态 field1/field2 → 对应字段 null。
 * <b>physical role = PROVEN；private protobuf symbol = UNKNOWN。</b></p>
 *
 * @param sequence                 事件顺序号
 * @param timestamp                时间戳
 * @param packetType               来源原始 packet type（=8）
 * @param confidence               解码置信度（结构 EXACT / 字段缺失时 PARTIAL）
 * @param turretYawRad             root.field1（null = 初始化变体缺失）
 * @param gunPitchRad              root.field2（null = 初始化变体缺失）
 * @param maxHorizontalRateRadS    root.field3
 * @param maxVerticalRateRadS      root.field4
 * @param aimingTimeScalarRaw      root.field5（PROVEN physical role）
 * @param dispersionBloomRaw       field6.field1（PROVEN physical role）
 * @param remainingConfigRaw       其余静态系数原始字节（PARTIAL）
 */
public record TargetingInfoSnapshotEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        Double turretYawRad,
        Double gunPitchRad,
        Double maxHorizontalRateRadS,
        Double maxVerticalRateRadS,
        Double aimingTimeScalarRaw,
        Double dispersionBloomRaw,
        byte[] remainingConfigRaw
) implements ReplayEvent {
}
