package com.wotb.core.replay.event;

/**
 * 命中结果事件（Type8 Vehicle method8 21-byte 变体；PR147 hit-resolution.md）。
 *
 * <p>PR147：method8 = direct vehicle-hit / hit-feedback family；packed bytes <b>绝不等同 HP damage</b>。
 * 只携带 attacker/victim + primary/secondary result category + packed metadata + 保守 penetration 分类。
 * 权威 HP loss 来自 Type7 prop3 连续 sample 的 delta，不由本事件字段推断。</p>
 *
 * <p>{@link PenetrationFamily#PENETRATION} 为 PROVEN behavioral subset：
 * {@code primary∈{3,4} || (primary==2 && secondary==0)}；其它（含未证明值）→ {@link PenetrationFamily#OTHER}。
 * 不给 0..4 invent 私有名字。</p>
 */
public record VehicleHitEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int attackerEntityId,
        int victimEntityId,
        int primaryResultRaw,
        int secondaryResultRaw,
        byte[] packedMetadataRaw,
        PenetrationFamily penetrationFamily
) implements ReplayEvent {

    /** 保守 penetration 分类（PR147 safe subset；未证明 → OTHER）。 */
    public enum PenetrationFamily {
        PENETRATION,
        OTHER
    }

    /** primary/secondary → conservative penetration classifier（PROVEN behavioral subset）。 */
    public static PenetrationFamily penetrationFamily(final int primary, final int secondary) {
        return (primary == 3 || primary == 4 || (primary == 2 && secondary == 0))
                ? PenetrationFamily.PENETRATION : PenetrationFamily.OTHER;
    }
}
