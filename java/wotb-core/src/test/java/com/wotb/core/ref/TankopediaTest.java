package com.wotb.core.ref;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TankopediaTest {

    @Test
    void loadsAlphaDamageForSingleGunTierTenTanks() {
        final Tankopedia tankopedia = Tankopedia.load();

        assertEquals(350, tankopedia.info(385).alphaDamage());
        assertEquals(370, tankopedia.info(14609).alphaDamage());
        assertEquals(570, tankopedia.info(20257).alphaDamage());
        assertEquals(420, tankopedia.info(6145).alphaDamage());
        assertEquals(400, tankopedia.info(29985).alphaDamage());   // SPHT 单炮
    }

    @Test
    void multiGunTierTenTanksExposeNoAuthoritativeAlphaDamage() {
        final Tankopedia tankopedia = Tankopedia.load();
        // E 100 有两把 10 级终局炮（12,8cm / 15cm），回放无法确定实际所用炮：
        // 不输出权威炮伤，避免把数组第一把炮的伤害伪装成本场实际炮伤。
        assertEquals(null, tankopedia.info(9489).alphaDamage());
    }
}
