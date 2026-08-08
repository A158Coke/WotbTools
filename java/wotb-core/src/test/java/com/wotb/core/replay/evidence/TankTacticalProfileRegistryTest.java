package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class TankTacticalProfileRegistryTest {

    private final TankTacticalProfileRegistry registry = TankTacticalProfileRegistry.load();

    @Test
    void curatedProfileByExactName() {
        final TankTacticalProfile kran = registry.profileFor(4481, "Kranvagn", "重坦", "10");
        assertTrue(kran.curated());
        assertEquals("HEAVY", kran.vehicleClass());
        assertEquals("HIGH", kran.hullDownAbility());
        assertTrue(kran.roles().contains("hull_down_heavy"));
    }

    @Test
    void curatedMatchIsCaseInsensitive() {
        final TankTacticalProfile lower = registry.profileFor(0, "kranvagn", "重坦", "10");
        assertTrue(lower.curated());
    }

    @Test
    void unknownTankFallsBackToClassDefault() {
        final TankTacticalProfile generic = registry.profileFor(0, "Some Tier 10", "重坦", "10");
        assertFalse(generic.curated());
        assertEquals("HEAVY", generic.vehicleClass());
        assertEquals("HIGH", generic.armorReliability());
    }

    @Test
    void mediumClassDefaultHasHighMobility() {
        final TankTacticalProfile medium = registry.profileFor(0, "T-54", "中坦", "9");
        assertEquals("MEDIUM", medium.vehicleClass());
        assertEquals("HIGH", medium.mobility());
    }

    @Test
    void normalizeClassHandlesChineseAndEnglish() {
        assertEquals("HEAVY", TankTacticalProfileRegistry.normalizeClass("重坦"));
        assertEquals("TANK_DESTROYER", TankTacticalProfileRegistry.normalizeClass("TD"));
        assertEquals("LIGHT", TankTacticalProfileRegistry.normalizeClass("轻坦"));
        assertEquals("UNKNOWN", TankTacticalProfileRegistry.normalizeClass(null));
    }
}
