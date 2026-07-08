package com.wotb.core.ref;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class MapNamesTest {

    @Test
    void returnsChineseLabelFromLocalizedMapping() {
        assertEquals("海岸礁湖", MapNames.cn("lagoon"));
        assertEquals("海岸礁湖", MapNames.cn("LAGOON"));
    }

    @Test
    void fallsBackToOriginalInternalNameWhenMissing() {
        assertEquals("unknown_map", MapNames.cn("unknown_map"));
    }
}
