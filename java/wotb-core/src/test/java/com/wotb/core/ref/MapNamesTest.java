package com.wotb.core.ref;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.StringNode;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

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

    @Test
    void fallsBackFromBlankChineseLabelToEnglish() throws Exception {
        final Method resolveChineseLabel = MapNames.class.getDeclaredMethod(
                "resolveChineseLabel", String.class, JsonNode.class);
        resolveChineseLabel.setAccessible(true);
        final JsonMapper mapper = JsonMapper.builder().build();

        assertEquals("Lagoon", invokeResolveChineseLabel(
                resolveChineseLabel, "lagoon", mapper.readTree("{\"zh\":\"   \",\"en\":\"Lagoon\"}")));
    }

    @Test
    void fallsBackToInternalNameWhenDirectLabelBlank() throws Exception {
        final Method resolveChineseLabel = MapNames.class.getDeclaredMethod(
                "resolveChineseLabel", String.class, JsonNode.class);
        resolveChineseLabel.setAccessible(true);

        assertEquals("lagoon", invokeResolveChineseLabel(
                resolveChineseLabel, "lagoon", StringNode.valueOf("   ")));
    }

    private static String invokeResolveChineseLabel(final Method resolveChineseLabel,
                                                    final String fallback,
                                                    final JsonNode node)
            throws InvocationTargetException, IllegalAccessException {
        return (String) resolveChineseLabel.invoke(null, fallback, node);
    }
}
