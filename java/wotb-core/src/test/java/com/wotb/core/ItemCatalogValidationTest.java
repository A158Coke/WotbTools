package com.wotb.core;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 物品目录 JSON 自动校验。
 */
class ItemCatalogValidationTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final Path CATALOG_DIR = Paths.get("").toAbsolutePath().getParent().getParent()
            .resolve("common").resolve("wotb-item-catalog-json");

    @Test
    void equipmentJsonIsValidAndIdsAreUnique() throws Exception {
        final var tree = load("equipment.json");
        final var items = tree.get("items");
        assertNotNull(items, "equipment.json must have items array");
        final Set<Integer> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        for (final var item : items) {
            assertTrue(ids.add(item.get("id").asInt()), "Duplicate equipment id: " + item.get("id"));
            assertTrue(codes.add(item.get("code").asText()), "Duplicate equipment code: " + item.get("code"));
            assertNotNull(item.get("effects"), "Equipment " + item.get("id") + " has null effects");
            assertTrue(item.get("effects").size() > 0, "Equipment " + item.get("id") + " has empty effects");
            validateEffects(item.get("effects"));
        }
    }

    @Test
    void consumablesJsonIsValidAndIdsAreUnique() throws Exception {
        final var tree = load("consumables.json");
        final var items = tree.get("items");
        assertNotNull(items);
        final Set<Integer> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        for (final var item : items) {
            assertTrue(ids.add(item.get("id").asInt()), "Duplicate consumable id: " + item.get("id"));
            assertTrue(codes.add(item.get("code").asText()), "Duplicate consumable code: " + item.get("code"));
            assertNotNull(item.get("cooldownSeconds"), "Consumable " + item.get("id") + " missing cooldownSeconds");
            if (item.has("durationSeconds") && !item.get("durationSeconds").isNull()) {
                assertTrue(item.get("durationSeconds").asInt() >= 0, "Consumable " + item.get("id") + " invalid duration");
            }
            assertNotNull(item.get("effects"));
            assertTrue(item.get("effects").size() > 0);
            validateEffects(item.get("effects"));
        }
    }

    @Test
    void provisionsJsonIsValidAndLogicalIdsAreUnique() throws Exception {
        final var tree = load("provisions.json");
        final var items = tree.get("items");
        assertNotNull(items);
        final Set<String> provisionIds = new HashSet<>();
        final Set<Integer> allSourceIds = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        for (final var item : items) {
            assertTrue(provisionIds.add(item.get("id").asText()), "Duplicate provision id: " + item.get("id"));
            assertTrue(codes.add(item.get("code").asText()), "Duplicate provision code: " + item.get("code"));
            if (item.has("sourceIds") && !item.get("sourceIds").isNull()) {
                for (final var sid : item.get("sourceIds")) {
                    assertTrue(allSourceIds.add(sid.asInt()), "Duplicate sourceId across provisions: " + sid.asInt());
                }
            }
        }
    }

    private static JsonNode load(final String fileName) throws Exception {
        final File file = CATALOG_DIR.resolve(fileName).toFile();
        assertTrue(file.exists(), "File not found: " + file);
        return MAPPER.readTree(file);
    }

    private static void validateEffects(final JsonNode effects) {
        for (final var effect : effects) {
            final String op = effect.get("operation").asText();
            if (effect.has("value") && !effect.get("value").isNull()) continue;
            if (effect.has("action") && !effect.get("action").isNull()) continue;
            // Accept all known ops without requiring value/action
            assertTrue(Set.of("MULTIPLY", "ADD", "SET", "INSTANT_ACTION",
                    "ADD_PERCENTAGE_POINTS", "SET_RELATIVE_RANGE").contains(op), "Unknown operation: " + op);
        }
    }
}
