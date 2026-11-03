package com.wotb.core.ref;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Alias normalization oracles: only exact registered aliases map to tankopedia canonical names. */
class TankNameAliasesTest {

    @Test
    void registeredAliasesResolveToCanonicalTankopediaNames() {
        final TankNameAliases aliases = TankNameAliases.load();
        assertEquals("Kranvagn", aliases.canonical("KRV"));
        assertEquals("Kranvagn", aliases.canonical("克朗瓦根"));
        assertEquals("Maus", aliases.canonical("老鼠"));
        assertEquals("E 100", aliases.canonical("E-100"));
        assertEquals("EMIL 1951", aliases.canonical("埃米尔1951"));
    }

    @Test
    void unregisteredOrNonCanonicalSpellingsReturnNull() {
        final TankNameAliases aliases = TankNameAliases.load();
        assertNull(aliases.canonical("kranvagn"));
        assertNull(aliases.canonical("KRV "));
        assertNull(aliases.canonical("not-an-alias"));
        assertNull(aliases.canonical(null));
    }

    @Test
    void theAliasKeySetIsExposedForBodyScanning() {
        final TankNameAliases aliases = TankNameAliases.load();
        assertTrue(aliases.aliases().contains("KRV"));
        assertTrue(aliases.aliases().size() >= 9);
    }
}
