package com.wotb.core.util;

import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PlayerResultFormatTest {
    @Test
    void deadSettlementLifeTimeIsReturnedAsIntegerSecondFact() {
        final PlayerResult player = new PlayerResult();
        player.survived = false;
        player.settlementLifeTimeSec = 128;
        player.deathTimeMillis = 128_120;
        assertEquals(128, PlayerResultFormat.deathSec(player), 1e-9);
    }

    @Test
    void liveProjectionCannotOverrideSettlement() {
        final PlayerResult player = new PlayerResult();
        player.survived = false;
        player.settlementLifeTimeSec = 100;
        player.deathTimeMillis = 200_000;
        player.survivalTimeSec = 300;
        assertEquals(100, PlayerResultFormat.deathSec(player), 1e-9);
    }
}
