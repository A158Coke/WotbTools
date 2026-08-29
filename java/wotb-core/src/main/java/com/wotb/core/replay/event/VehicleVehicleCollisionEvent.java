package com.wotb.core.replay.event;

import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 载具-载具碰撞接触事件（Type8 <b>Vehicle</b> method4，16-byte args；PR147 vehicle-method4-vehicle-collision-contact.md）。
 *
 * <p>只有 <b>Vehicle entity-class</b> 上 method4 的 16-byte 变体才属于本事件家族；Avatar method4 使用
 * 不同的 2-byte schema（即 {@link RoundFinishedEvent}），与本事件无关。Wire 结构：</p>
 *
 * <pre>{@code
 * sharedScalar  : f32 LE
 * contactPoint  : VECTOR3&lt;f32&gt;
 * }</pre>
 *
 * <p><b>保守边界</b>：{@code sharedScalar} 是配对碰撞中的共享物理参数（每对碰撞两参与方完全相等），
 * 但<b>不得</b>转换成 damage / force / relative speed。本事件是碰撞/ramming 的<b>几何证据</b>，
 * 权威伤害来自 Type7 prop3 连续 sample 的 delta；字段名保持证据名，不 invent 伤害/攻击者/受害者。</p>
 *
 * @param sequence        事件顺序号
 * @param timestamp       时间戳
 * @param packetType      来源原始 packet type（=8）
 * @param confidence      解码置信度（结构/非有限向量校验成功即 EXACT）
 * @param vehicleEntityId method4 调用目标实体（参与碰撞的载具）
 * @param sharedScalar    共享碰撞标量（配对两参与方相等；不解释为伤害/力/相对速度）
 * @param contactPointWorld 世界空间接触点（VECTOR3；有限值才产出）
 */
public record VehicleVehicleCollisionEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int vehicleEntityId,
        float sharedScalar,
        Vector3 contactPointWorld
) implements ReplayEvent {
}
