package com.wotb.core.ref;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
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
                "resolveChineseLabel", String.class, com.fasterxml.jackson.databind.JsonNode.class);
        resolveChineseLabel.setAccessible(true);
        final ObjectMapper mapper = new ObjectMapper();

        assertEquals("Lagoon", invokeResolveChineseLabel(
                resolveChineseLabel, "lagoon", mapper.readTree("{\"zh\":\"   \",\"en\":\"Lagoon\"}")));
    }

    @Test
    void fallsBackToInternalNameWhenDirectLabelBlank() throws Exception {
        final Method resolveChineseLabel = MapNames.class.getDeclaredMethod(
                "resolveChineseLabel", String.class, com.fasterxml.jackson.databind.JsonNode.class);
        resolveChineseLabel.setAccessible(true);

        assertEquals("lagoon", invokeResolveChineseLabel(
                resolveChineseLabel, "lagoon", TextNode.valueOf("   ")));
    }

    private static String invokeResolveChineseLabel(final Method resolveChineseLabel,
                                                    final String fallback,
                                                    final com.fasterxml.jackson.databind.JsonNode node)
            throws InvocationTargetException, IllegalAccessException {
        return (String) resolveChineseLabel.invoke(null, fallback, node);
    }
}
