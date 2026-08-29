package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.ShotResultEvent;

import java.util.List;

/**
 * method38 low-16 射击结果 flags（当前 11.19 bit map）。
 *
 * <p>flags 是正交多 bit 集合，不是互斥枚举；一次命中可以同时包含多个 resolution 事实。
 * 未观测/未证明的 bit 保留 raw，不得命名（尤其 {@code 0x0200}：当前无样本，只能 raw）。</p>
 *
 * <p>modifier：additive modifierId list——1 = Precision Fire proc，
 * 2 = Tungsten Shells；可同时 [1,2]（controlled JagdPanzer probe）。未知 ID 保留 raw。</p>
 */
public record ShotResolution(
        int rawFlags16,
        boolean directKill,
        boolean targetAlreadyDead,
        boolean fireStarted,
        boolean ricochet,
        boolean projectileMaterialPierced,
        boolean projectileMaterialStopped,
        boolean projectileZeroDfArmorPierced,
        boolean projectileZeroDfArmorNotPierced,
        boolean projectileComponentInvolvement,
        boolean projectileTrackChassisDamage,
        boolean projectileGunDamage,
        boolean explosionMaterialPositiveDf,
        boolean explosionZeroDfArmor,
        boolean explosionComponentInvolvement,
        boolean explosionComponentDamage,
        List<Integer> modifierIds,
        List<ShotResultEvent.ComponentResult> components
) {

    /** 0x0200：当前未观测，禁止命名（candidate = device-not-pierced，仅为未来样本保留）。 */
    public static final int BIT_0200_UNOBSERVED_RAW = 0x0200;

    /**
     * 由 method38 raw flags + extension + component list 构建（bit map 见
     * docs/research/replay/method38-current-hit-flag-reconstruction.md）。
     */
    public static ShotResolution of(
            final int flags16,
            final List<Integer> modifierIds,
            final List<ShotResultEvent.ComponentResult> components) {
        return new ShotResolution(
                flags16,
                bit(flags16, 0x0001),
                bit(flags16, 0x0002),
                bit(flags16, 0x0004),
                bit(flags16, 0x0008),
                bit(flags16, 0x0010),
                bit(flags16, 0x0020),
                bit(flags16, 0x0040),
                bit(flags16, 0x0080),
                bit(flags16, 0x0100),
                bit(flags16, 0x0400),
                bit(flags16, 0x0800),
                bit(flags16, 0x1000),
                bit(flags16, 0x2000),
                bit(flags16, 0x4000),
                bit(flags16, 0x8000),
                modifierIds == null ? List.of() : List.copyOf(modifierIds),
                components == null ? List.of() : List.copyOf(components));
    }

    private static boolean bit(final int flags, final int mask) {
        return (flags & mask) != 0;
    }
}
