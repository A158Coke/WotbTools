package com.wotb.core.replay.event;

/**
 * 车辆 HP/状态方法事件（Vehicle-targeted method1，7-byte args）。
 *
 * <p>wire body = {@code currentHpRaw(u16 LE) + sourceEntity(u32 LE) + causeFlag(u8)}；
 * {@code currentHpRaw} 与同刻 Vehicle Type7 prop3 raw16 完全一致，提供选中 HP 转变的归属/原因补充。
 * 已知 causeFlag 映射为 0 direct / 1 fire / 2 ramming / 3 world-or-self-environment /
 * 5 drowning；其它值保留 raw。</p>
 *
 * <p>{@link #rawState()} 由 decoder 在原始 HP 值上一次分类并随事件传播；消费方一律直接使用该分类。
 * 无法证明的 sentinel 保留 raw 并保持未知，不能无条件升级。{@link #cause()} 同理：未知 flag
 * 保留 raw，语义为 {@link Cause#UNKNOWN}。</p>
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
 * @param causeFlag     伤害/死亡原因 flag（已知 flag 做结构内映射；其它保留 raw）
 * @param cause         语义化原因枚举；{@link Cause#UNKNOWN} = 未观测或未知 flag，保留 raw
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
        WORLD_OR_SELF_ENVIRONMENT,
        DROWNING,
        UNKNOWN
    }

    /** causeFlag → 语义化原因；未观测 flag → UNKNOWN（保留 raw，不按序号臆测）。 */
    public static Cause causeOf(final int flag) {
        return switch (flag) {
            case 0 -> Cause.DIRECT;
            case 1 -> Cause.FIRE;
            case 2 -> Cause.RAMMING;
            case 3 -> Cause.WORLD_OR_SELF_ENVIRONMENT;
            case 5 -> Cause.DROWNING;
            default -> Cause.UNKNOWN;
        };
    }

    public VehicleHealthStateEvent {
        rawState = rawState == null ? HpRawState.UNKNOWN_OTHER : rawState;
        cause = cause == null ? Cause.UNKNOWN : cause;
    }
}
