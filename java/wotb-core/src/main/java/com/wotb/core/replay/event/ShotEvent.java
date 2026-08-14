package com.wotb.core.replay.event;

/**
 * 开炮事件（无直接伤害结果）：来自 Packet Type 8 EntityMethod 的伤害方法包
 * （body[13] 伤害子类型 ≠ 3，或 =3 但伤害值 0——被吸收/弹跳等）。
 *
 * <p>结构已证明：与 {@link DamageEvent} 同一方法包封套（body[4..7] 攻击者 eid、
 * body[8..11] 目标 eid）；但该包不携带弹道方向，渲染方向必须使用已证明的炮塔世界方向
 * （type-7 propId=2：{@code turretWorldYaw = hullYaw + turretRelativeYaw}），
 * 不得声称真实弹道；目标 eid 的含义（瞄准目标/最近实体）未经证明，只作原始事实保留。</p>
 */
public record ShotEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int attackerEid,
        int victimEid,
        Long attackerAccountId,
        Long victimAccountId
) implements ReplayEvent {
}
