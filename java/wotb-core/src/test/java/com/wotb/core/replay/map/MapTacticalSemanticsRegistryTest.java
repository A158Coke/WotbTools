package com.wotb.core.replay.map;

import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.Test;

class MapTacticalSemanticsRegistryTest {

    private final MapTacticalSemanticsRegistry registry = MapTacticalSemanticsRegistry.load();

    @Test
    void v1RegistryHasNoCuratedMapData() {
        // V1 语义库为空：没有经过验证的地图数据，任何地图都必须返回 UNKNOWN
        assertFalse(registry.semanticsFor("erlenberg").hasSemantics());
        assertFalse(registry.semanticsFor("himmelsdorf").hasSemantics());
        assertFalse(registry.semanticsFor("canyon").hasSemantics());
        assertFalse(registry.semanticsFor("lagoon").hasSemantics());
    }

    @Test
    void unknownOrBlankMapCodeReturnsUnknown() {
        assertFalse(registry.semanticsFor("not_a_real_map").hasSemantics());
        assertFalse(registry.semanticsFor(null).hasSemantics());
        assertFalse(registry.semanticsFor("").hasSemantics());
    }
}
