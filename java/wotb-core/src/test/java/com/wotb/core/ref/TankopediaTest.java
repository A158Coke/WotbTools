package com.wotb.core.ref;

import com.wotb.core.model.TankInfo;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TankopediaTest {

    @Test
    void loadsAlphaDamageForSingleGunTierTenTanks() {
        final Tankopedia tankopedia = TankopediaReferenceData.tankopedia();

        assertEquals(350, tankopedia.info(385).alphaDamage());
        assertEquals(370, tankopedia.info(14609).alphaDamage());
        assertEquals(570, tankopedia.info(20257).alphaDamage());
        assertEquals(420, tankopedia.info(6145).alphaDamage());
        assertEquals(400, tankopedia.info(29985).alphaDamage());   // SPHT 单炮
    }

    @Test
    void multiGunTierTenTanksExposeNoAuthoritativeAlphaDamage() {
        final Tankopedia tankopedia = TankopediaReferenceData.tankopedia();
        // E 100 有两把 10 级终局炮（12,8cm / 15cm），回放无法确定实际所用炮：
        // 不输出权威炮伤，避免把数组第一把炮的伤害伪装成本场实际炮伤。
        assertEquals(null, tankopedia.info(9489).alphaDamage());
    }

    @Test
    void loadsLowerTierNamesAndKeepsUnknownIdsExplicit() {
        final Tankopedia tankopedia = TankopediaReferenceData.tankopedia();
        assertEquals("KV-2", tankopedia.info(10497).name());
        assertEquals(6, tankopedia.info(10497).tier());
        assertEquals("Hellcat", tankopedia.info(11553).name());
        assertEquals("SU-100", tankopedia.info(3585).name());
        assertEquals("#2147483647", tankopedia.info(2147483647L).name());
    }

    @Test
    void legacyLoadReturnsApplicationSharedReference() {
        assertSame(TankopediaReferenceData.tankopedia(), Tankopedia.load());
        assertSame(Tankopedia.load(), Tankopedia.load());
    }

    @Test
    void publishedNameSetIsImmutable() {
        final var names = TankopediaReferenceData.tankopedia().names();
        assertThrows(UnsupportedOperationException.class, () -> names.add("not-a-real-tank"));
    }

    @Test
    void publishedNameSetIsBuiltFromTheTierFilesRatherThanLeftEmpty() {
        final var names = TankopediaReferenceData.tankopedia().names();
        assertTrue(names.contains("KV-2"));
        assertTrue(names.contains("Tiger II"));
        assertTrue(names.size() > 100);
    }

    @Test
    void structuredVehicleFieldsComeFromTheTierFilesWithStableFallbacks() {
        final Tankopedia tankopedia = TankopediaReferenceData.tankopedia();
        assertEquals("Heavy tank", tankopedia.info(10497).type());
        assertEquals("USSR", tankopedia.info(10497).nation());
        assertEquals("", tankopedia.info(10497).extraInfo());
        final TankInfo tiger = tankopedia.info(5137);
        assertEquals("Tiger II", tiger.name());
        assertEquals(8, tiger.tier());
        assertEquals(1850, tiger.maxHp());
        assertEquals(310, tiger.alphaDamage());
        final TankInfo unknown = tankopedia.info(987654321L);
        assertEquals("", unknown.type());
        assertEquals("", unknown.nation());
        assertEquals("", unknown.extraInfo());
    }

    @Test
    void resourceBootstrapProducesTheSharedInstanceWithoutReloads() {
        final Tankopedia loaded = TankopediaReferenceData.tankopedia();
        assertTrue(loaded.size() > 100);
    }
}
