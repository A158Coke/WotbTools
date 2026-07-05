package com.wotb.core.ref;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TankopediaTest {

    @Test
    void loadsAlphaDamageForKnownTierTenTanks() {
        final Tankopedia tankopedia = Tankopedia.load();

        assertEquals(340, tankopedia.info(28689).alphaDamage());
        assertEquals(620, tankopedia.info(11825).alphaDamage());
        assertEquals(570, tankopedia.info(20257).alphaDamage());
        assertEquals(420, tankopedia.info(6145).alphaDamage());
        assertEquals(645, tankopedia.info(9489).alphaDamage());
    }
}
