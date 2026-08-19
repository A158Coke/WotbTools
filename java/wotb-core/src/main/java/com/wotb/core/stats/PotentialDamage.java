package com.wotb.core.stats;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;

import java.util.List;

/** Computes potential damage from per-victim kill damage details. */
public final class PotentialDamage {

    /** Damage details against one victim killed by the attacker. */
    public record KillVictim(long victimAccountId, int damage, int penetrations) {
    }

    /** One battle's potential damage result for a player. */
    public record BattlePotential(int actualDamage, int potentialDamage, int supplementDamage) {
    }

    private static final double MIN_ALPHA_RATIO = 0.9;

    private PotentialDamage() {
    }

    public static BattlePotential computeBattle(final int actualDamage, final int alphaDamage,
                                                final List<KillVictim> victims) {
        if (actualDamage < 0) {
            throw new IllegalArgumentException("actualDamage must be >= 0");
        }
        if (alphaDamage <= 0 || victims == null || victims.isEmpty()) {
            return new BattlePotential(actualDamage, actualDamage, 0);
        }
        int supplement = 0;
        for (final KillVictim victim : victims) {
            supplement += supplementForVictim(alphaDamage, victim);
        }
        return new BattlePotential(actualDamage, actualDamage + supplement, supplement);
    }

    public static double average(final List<BattlePotential> battles) {
        if (battles == null || battles.isEmpty()) {
            return 0;
        }
        long total = 0;
        for (final BattlePotential battle : battles) {
            total += battle.potentialDamage();
        }
        return (double) total / battles.size();
    }

    /** Applies the current potential-damage rule to every player in a replay batch. */
    public static void apply(final List<Battle> battles, final Tankopedia tp) {
        if (battles == null) {
            return;
        }
        for (final Battle battle : battles) {
            for (final PlayerResult player : battle.players) {
                final Integer alpha = tp.info(player.tankId).alphaDamage();
                final int alphaDamage = alpha == null ? 0 : alpha;
                final BattlePotential result = computeBattle(player.damageDealt, alphaDamage, player.killVictims);
                player.potentialDamage = result.potentialDamage();
                player.potentialDamageSupplement = result.supplementDamage();
                player.potentialDamageDetailed = alphaDamage > 0 && !player.killVictims.isEmpty();
            }
        }
    }

    private static int supplementForVictim(final int alphaDamage, final KillVictim victim) {
        if (victim == null || victim.damage() < 0 || victim.penetrations() <= 0) {
            return 0;
        }
        final double minimum = victim.penetrations() * alphaDamage * MIN_ALPHA_RATIO;
        if (victim.damage() >= minimum) {
            return 0;
        }
        return (int) Math.ceil(minimum - victim.damage());
    }
}
