package com.wotb.core.ref;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TankopediaTest {

    @Test
    void loadsAlphaDamageForKnownTierTenTanks() {
        final Tankopedia tankopedia = Tankopedia.load();

        assertEquals(350, tankopedia.info(385).alphaDamage());
        assertEquals(370, tankopedia.info(14609).alphaDamage());
        assertEquals(570, tankopedia.info(20257).alphaDamage());
        assertEquals(420, tankopedia.info(6145).alphaDamage());
        assertEquals(460, tankopedia.info(9489).alphaDamage());
    }
}
