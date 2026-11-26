package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.ShotResultEvent;

import java.util.List;

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

    public static final int BIT_0200_UNOBSERVED_RAW = 0x0200;

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
