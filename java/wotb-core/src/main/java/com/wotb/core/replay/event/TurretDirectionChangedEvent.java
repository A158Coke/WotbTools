package com.wotb.core.replay.event;

/**
 * 炮塔相对方向变化事件（Packet Type 7 EntityProperty 的 propId=2）。
 *
 * <p>编码（2026-08-13 旋转实验 + 开火锚点拟合证明，docs/turret-direction-evidence-notes.md）：
 * valueLen=2 的 u16 LE，角度 = {@code raw * 360.0 / 65536.0 - 180.0}（度，[-180, 180)），
 * 完整 360° 且绕 ±180° 回绕；与 type-10 yaw 同旋转方向约定（顺时针为正）。
 * 炮口世界方向 = normalize(hullYaw + turretRelativeYaw)（开火命中锚点拟合残差 9.5°、
 * 独立受击集交叉验证 2.3°）。hullYaw 来自同车最近 {@link PositionChangedEvent#yaw()}（弧度）。</p>
 *
 * @param sequence             事件顺序号
 * @param timestamp            时间戳
 * @param packetType           来源原始 packet type（7）
 * @param confidence           解码置信度（EXACT）
 * @param entityId             实体 ID
 * @param turretRelativeYawDeg 炮塔相对车体偏航角（度，[-180, 180)）
 */
public record TurretDirectionChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        double turretRelativeYawDeg
) implements ReplayEvent {

    public TurretDirectionChangedEvent {
        if (Double.isNaN(turretRelativeYawDeg) || Double.isInfinite(turretRelativeYawDeg)) {
            throw new IllegalArgumentException("turretRelativeYawDeg must be finite: " + turretRelativeYawDeg);
        }
    }
}
