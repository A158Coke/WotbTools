package com.wotb.core.replay.event;

import java.util.List;

/**
 * 录像者射击结果反馈事件（Avatar-targeted method38）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/avatar-shot-result-bitfield.md、
 * method38-current-hit-flag-reconstruction.md）：
 * <pre>
 *   victimVehicleId : u32 LE
 *   headerFlags32   : u32 LE   （low16 = resultFlags16；high16 保留 raw）
 *   resultCount     : u8
 *   repeat resultCount times:
 *       componentToken : u8
 *       rawState       : u8
 *   modifierCount   : u8
 *   repeat modifierCount times:
 *       modifierId  : u32 LE
 * </pre>
 * low-16 flags 是正交多 bit 集合，不是互斥枚举；{@code 0x0200} 当前未观测，保留 raw
 * 不得命名。modifier list 是 additive（1=Precision Fire / 2=Tungsten，可同时 [1,2]），
 * 不是 hit flag（docs/research/replay/precision-fire-method38-extension.md）。</p>
 *
 * @param sequence         事件顺序号
 * @param timestamp        时间戳
 * @param packetType       来源原始 packet type（=8）
 * @param confidence       解码置信度（结构 EXACT；单个 bit 语义置信度见 {@link ComponentKind} 等）
 * @param victimVehicleId  受击车辆实体 ID
 * @param resultFlags16    low-16 结果 flags（保留原始 bitset）
 * @param headerHi16Raw    高位原始 u16（当前 corpus 0x0002/0x0012/0x0028，保留 raw）
 * @param components       组件/乘员结果列表（token + state）
 * @param modifierIds      本发命中的特殊 modifier 列表（1=Precision Fire / 2=Tungsten；
 *                         未知 ID 保留 raw 不拒绝）
 */
public record ShotResultEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int victimVehicleId,
        int resultFlags16,
        int headerHi16Raw,
        List<ComponentResult> components,
        List<Integer> modifierIds
) implements ReplayEvent {

    /** 组件/乘员命中结果（method38 componentToken + rawState）。 */
    public record ComponentResult(int token, int state) {
    }

    /**
     * method38 组件 token 语义（docs/research/replay/method38-component-token-namespace.md）。
     * 42 未在 corpus 观测 → {@link #UNKNOWN}，保留 raw。
     */
    public enum ComponentKind {
        ENGINE(31),
        AMMO_RACK(32),
        FUEL_TANK(33),
        RIGHT_TRACK(34),
        LEFT_TRACK(35),
        GUN(36),
        TURRET_ROTATOR(37),
        OBSERVATION_DEVICE(38),
        COMMANDER(39),
        DRIVER(40),
        GUNNER(41),
        LOADER(43),
        UNKNOWN(-1);

        private final int token;

        ComponentKind(final int token) {
            this.token = token;
        }

        /** token → 语义化组件；未观测 token → UNKNOWN（保留 raw）。 */
        public static ComponentKind of(final int token) {
            for (final ComponentKind kind : values()) {
                if (kind.token == token) {
                    return kind;
                }
            }
            return UNKNOWN;
        }
    }
}
