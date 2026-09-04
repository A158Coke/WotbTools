package com.wotb.core;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SettlementCanonicalModelTest {
    @Test
    void settlementLifeTimeIsTheOnlyBusinessDeathAuthority() {
        final PlayerResult dead = new PlayerResult();
        dead.survived = false;
        dead.settlementLifeTimeSec = 128;
        dead.deathTimeMillis = 128_120;
        dead.survivalTimeSec = 999;
        assertEquals(128, PlayerResultFormat.deathSec(dead), 1e-9);
    }

    @Test
    void survivorHasNoBusinessDeathSecond() {
        final PlayerResult alive = new PlayerResult();
        alive.survived = true;
        alive.settlementLifeTimeSec = 300;
        assertEquals(0, PlayerResultFormat.deathSec(alive), 1e-9);
    }
}
