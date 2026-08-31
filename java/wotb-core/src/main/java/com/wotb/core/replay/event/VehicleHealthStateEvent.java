package com.wotb.core.replay.event;

/**
 * 车辆 HP/状态方法事件（Vehicle-targeted method1，7-byte args）。
 *
 * <p>wire body = {@code currentHpRaw(u16 LE) + sourceEntity(u32 LE) + causeFlag(u8)}；
 * {@code currentHpRaw} 与同刻 Vehicle Type7 prop3 raw16 完全一致，提供选中 HP 转变的归属/原因补充。
 * decoder 永久保留 {@code causeFlag} raw，不能仅凭数字直接提升为 authoritative semantic。</p>
 *
 * <p>{@link #rawState()} 由 decoder 在原始 HP 值上一次分类并随事件传播；消费方一律直接使用该分类。
 * 无法证明的 sentinel 保留 raw 并保持未知，不能无条件升级。{@link #cause()} 仅由字段专用
 * evidence validator 在跨字段证据闭合后填写；未验证时为 {@code null}。</p>
 *
 * <p>注意：{@code currentHpRaw > 0} 不是通用存活谓词；死亡分类必须优先显式 terminal/death
 * surface，而不是通用 HP 谓词。</p>
 *
 * @param sequence      事件顺序号
 * @param timestamp     时间戳
 * @param packetType    来源原始 packet type（=8）
 * @param confidence    解码置信度（结构/HP/cause 按可证明的 wire evidence）
 * @param entityId      方法调用目标实体（victim/受击者）
 * @param currentHpRaw  当前 HP/terminal-state 原始 u16 值（与 prop3 raw16 同语义）
 * @param sourceEntity  伤害来源实体
 * @param causeFlag     伤害/死亡原因 raw flag
 * @param cause         经跨字段验证的语义化原因；未验证为 null
 * @param rawState      decoder 边界分类的原始 u16 HP/terminal 状态，随事件传播
 */
public record VehicleHealthStateEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int currentHpRaw,
        int sourceEntity,
        int causeFlag,
        Cause cause,
        HpRawState rawState
) implements ReplayEvent {

    /** method1 causeFlag 语义化原因。 */
    public enum Cause {
        DIRECT,
        FIRE,
        RAMMING,
        WORLD_OR_ENVIRONMENT,
        DROWNING
    }

    public VehicleHealthStateEvent {
        rawState = rawState == null ? HpRawState.UNKNOWN_OTHER : rawState;
    }
}
