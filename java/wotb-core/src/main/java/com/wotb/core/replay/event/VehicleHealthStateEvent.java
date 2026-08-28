package com.wotb.core.replay.event;

/**
 * 车辆 HP/状态方法事件（Vehicle-targeted method1，7-byte args）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/vehicle-method1-hp-source-damage-cause.md）：
 * wire body = {@code currentHpRaw(u16 LE) + sourceEntity(u32 LE) + causeFlag(u8)}；
 * {@code currentHpRaw} 与同刻 Vehicle Type7 prop3 raw16 完全一致（3,471/3,471），
 * 提供选中 HP 转变的归属/原因补充。causeFlag 映射（PROVEN）：
 * 0 direct / 1 fire / 2 ramming / 3 world-or-self-environment / 5 drowning；
 * 4 未观测，保留 raw。</p>
 *
 * <p>注意：{@code currentHpRaw > 0} 不是通用存活谓词（drowning 控制样本：死亡时仍携带正 HP）；
 * 死亡分类必须优先显式 terminal/death surface，而不是通用 HP 谓词。</p>
 *
 * @param sequence      事件顺序号
 * @param timestamp     时间戳
 * @param packetType    来源原始 packet type（=8）
 * @param confidence    解码置信度（结构/HP/cause PROVEN）
 * @param entityId      方法调用目标实体（victim/受击者）
 * @param currentHpRaw  当前 HP/terminal-state 原始 u16 值（与 prop3 raw16 同语义）
 * @param sourceEntity  伤害来源实体（fire=点燃者 / ramming=碰撞对方 / world-or-self=self / drowning=self）
 * @param causeFlag     伤害/死亡原因 flag（0/1/2/3/5 PROVEN；其它保留 raw）
 * @param cause         语义化原因枚举；{@link #UNKNOWN} = 未观测 flag，保留 raw
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
        Cause cause
) implements ReplayEvent {

    /** method1 causeFlag 语义化原因（docs/research/replay/vehicle-method1-hp-source-damage-cause.md）。 */
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
}
