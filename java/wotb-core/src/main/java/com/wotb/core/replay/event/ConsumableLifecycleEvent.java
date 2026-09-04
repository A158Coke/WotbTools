package com.wotb.core.replay.event;

/**
 * Type32 mobile {@code flag=0} 16-byte body 的 consumable lifecycle semantic event
 * （docs/research/replay/consumable-lifecycle.md，P0-2/P0-5）。
 *
 * <p><b>仅</b>对 proven 组合解码：{@code entityClass == VEHICLE} + {@code flag == 0}
 * + {@code bodyLength == 16}。其它 flag/长度/
 * 实体类组合保持 raw-preserve（见 {@link EntityAuxiliaryBlobEvent}），<b>绝不</b>把 flag=1 短族、
 * static 实体或 15 字节 body 当 consumable。</p>
 *
 * <p>wire：{@code body[2]=wireCode}、{@code body[3]=state}、{@code body[4..12)=eventClockRaw f64 LE}、
 * {@code body[12..16)=effectiveParamSec f32 LE}。state 映射：{@code 1=INITIALIZED}、
 * {@code 2=ACTIVATED}、{@code 3=ACTIVE_ENDED_OR_COOLDOWN}、{@code 255=TEARDOWN}。</p>
 *
 * <p>unproven wireCode → {@code logicalItemId=null} + raw wireCode 保留；绝不按国家/坦克/数值猜名。</p>
 *
 * @param sequence          事件顺序号
 * @param timestamp         时间戳
 * @param packetType        原始包类型（=32）
 * @param confidence        semantic 解码置信度（identity+state 都 proven → EXACT；否则 PARTIAL）
 * @param entityId          车辆实体 id
 * @param rawClockSec       包原始时钟（double，battle-relative 派生用）
 * @param wireCode          consumable wire code（body[2] 原值）
 * @param logicalItemId     proven logical identity；null = 未证明（wire/raw 保留）
 * @param state             lifecycle state
 * @param eventClockRaw     body[4..12) f64 LE 原始事件时钟（可为 0/absent，语义为 session-local 时钟）
 * @param effectiveParamSec body[12..16) f32 LE 有效参数秒（duration/cooldown 配置，可能为 0）
 */
public record ConsumableLifecycleEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        double rawClockSec,
        int wireCode,
        String logicalItemId,
        ConsumableLifecycleState state,
        double eventClockRaw,
        float effectiveParamSec
) implements ReplayEvent {

    /** consumable lifecycle state（wire→state 骨：1/2/3/255）。 */
    public enum ConsumableLifecycleState {
        INITIALIZED,
        ACTIVATED,
        ACTIVE_ENDED_OR_COOLDOWN,
        TEARDOWN,
        UNKNOWN
    }

    public static ConsumableLifecycleState stateOf(final int wireState) {
        return switch (wireState) {
            case 1 -> ConsumableLifecycleState.INITIALIZED;
            case 2 -> ConsumableLifecycleState.ACTIVATED;
            case 3 -> ConsumableLifecycleState.ACTIVE_ENDED_OR_COOLDOWN;
            case 255 -> ConsumableLifecycleState.TEARDOWN;
            default -> ConsumableLifecycleState.UNKNOWN;
        };
    }

    /**
     * Version-scoped consumable wireCode→logicalItemId mapping shared by Type32 and Type5.
     * Unknown values remain null while the raw wireCode is preserved by the caller.
     */
    public static String logicalItemIdOf(final int wireCode) {
        return switch (wireCode) {
            case 0x08 -> "AUTOMATIC_FIRE_EXTINGUISHER";
            case 0x09 -> "ADRENALINE";
            case 0x0A -> "ENGINE_POWER_BOOST";
            case 0x0B -> "MULTI_PURPOSE_RESTORATION_PACK";
            case 0x0C -> "FIRST_AID_KIT";
            case 0x0D -> "REPAIR_KIT";
            case 0x3D -> "IMPROVED_ENGINE_POWER_BOOST";
            case 0x3E -> "RETICLE_CALIBRATION";
            case 0x42 -> "REACTIVE_ARMOR";
            case 0x69 -> "TUNGSTEN_SHELLS";
            case 0xBD -> "REDUCED_ENGINE_POWER_BOOST";
            default -> null;
        };
    }

    /** 该事件是否为已知 consumable（identity proven）。 */
    public boolean identityProven() {
        return logicalItemId != null;
    }
}
