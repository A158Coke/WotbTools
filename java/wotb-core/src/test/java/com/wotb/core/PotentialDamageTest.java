package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PotentialDamage;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class PotentialDamageTest {

    @Test
    void usesPerVictimPenetrationsAndAlpha() {
        final PotentialDamage.BattlePotential result = PotentialDamage.computeBattle(3840, 400, List.of(
                new PotentialDamage.KillVictim(1, 1600, 4),
                new PotentialDamage.KillVictim(2, 1000, 3),
                new PotentialDamage.KillVictim(3, 1240, 4)
        ));

        assertEquals(4120, result.potentialDamage());
        assertEquals(280, result.supplementDamage());
        assertEquals(4120, Math.round(PotentialDamage.average(List.of(result))));
    }

    @Test
    void doesNotChangeActualDamageWhenVictimDamageMeetsThreshold() {
        final PotentialDamage.BattlePotential result = PotentialDamage.computeBattle(1600, 400, List.of(
                new PotentialDamage.KillVictim(1, 1600, 4)
        ));

        assertEquals(1600, result.actualDamage());
        assertEquals(1600, result.potentialDamage());
        assertEquals(0, result.supplementDamage());
    }

    @Test
    void applyKeepsActualDamageWhenKillVictimDetailsAreMissing() {
        final PlayerResult player = new PlayerResult();
        player.tankId = -1;
        player.damageDealt = 1234;
        final Battle battle = new Battle();
        battle.players = List.of(player);

        PotentialDamage.apply(List.of(battle), Tankopedia.load());

        assertEquals(1234, player.potentialDamage);
        assertEquals(0, player.potentialDamageSupplement);
        assertFalse(player.potentialDamageDetailed);
    }
}
