package com.wotb.web.hof.policy;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HallOfFameBattleTypePolicyTest {

    @Test
    void resolvesRandomAndRating() {
        assertEquals(HallOfFameBattleType.RANDOM, HallOfFameBattleTypePolicy.resolve(1).orElseThrow());
        assertEquals(HallOfFameBattleType.RATING, HallOfFameBattleTypePolicy.resolve(7).orElseThrow());
        assertTrue(HallOfFameBattleTypePolicy.isSupported(1));
        assertTrue(HallOfFameBattleTypePolicy.isSupported(7));
    }

    @Test
    void rejectsEverythingElse() {
        for (final Integer raw : new Integer[]{null, 0, 2, 3, 4, 5, 6, 8, 9, 22, 999}) {
            assertTrue(HallOfFameBattleTypePolicy.resolve(raw).isEmpty(), "arenaBonusType=" + raw);
            assertFalse(HallOfFameBattleTypePolicy.isSupported(raw), "arenaBonusType=" + raw);
        }
    }

    @Test
    void rawValuesMatchStoredContract() {
        assertEquals(1, HallOfFameBattleType.RANDOM.arenaBonusType());
        assertEquals(7, HallOfFameBattleType.RATING.arenaBonusType());
    }
}
