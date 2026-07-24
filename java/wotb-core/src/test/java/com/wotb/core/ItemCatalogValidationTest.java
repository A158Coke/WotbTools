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
            validateGrid(item.get("grid"));
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
            assertTrue(item.hasNonNull("cooldownSeconds") && item.get("cooldownSeconds").asInt() > 0,
                    "Consumable " + item.get("id") + " missing or invalid cooldownSeconds");
            final String activationType = item.has("activationType") ? item.get("activationType").asText() : "";
            if ("DURATION".equals(activationType)) {
                assertTrue(item.hasNonNull("durationSeconds") && item.get("durationSeconds").asInt() > 0,
                        "DURATION consumable " + item.get("id") + " missing or invalid durationSeconds");
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
            assertTrue(item.hasNonNull("sourceIds"), "Provision " + item.get("id") + " missing sourceIds");
            assertTrue(item.get("sourceIds").size() > 0, "Provision " + item.get("id") + " has empty sourceIds");
            for (final var sid : item.get("sourceIds")) {
                assertTrue(sid.asInt() >= 0, "Provision " + item.get("id") + " negative sourceId: " + sid.asInt());
                assertTrue(allSourceIds.add(sid.asInt()), "Duplicate sourceId across provisions: " + sid.asInt());
            }
            if (item.has("effects")) {
                validateEffects(item.get("effects"));
            }
        }
    }

    private static JsonNode load(final String fileName) throws Exception {
        final File file = CATALOG_DIR.resolve(fileName).toFile();
        assertTrue(file.exists(), "File not found: " + file);
        return MAPPER.readTree(file);
    }

    private static void validateEffects(final JsonNode effects) {
        assertNotNull(effects);
        assertTrue(effects.size() > 0, "Effects must be non-empty");
        for (final var effect : effects) {
            assertTrue(effect.hasNonNull("operation"), "Effect missing operation");
            final String op = effect.get("operation").asText();
            switch (op) {
                case "MULTIPLY", "ADD", "SET", "ADD_PERCENTAGE_POINTS" ->
                    assertTrue(effect.hasNonNull("value"), op + " requires value");
                case "INSTANT_ACTION" ->
                    assertTrue(effect.hasNonNull("action"), "INSTANT_ACTION requires action");
                case "SET_RELATIVE_RANGE" -> {
                    assertTrue(effect.hasNonNull("minimumMultiplier"), "SET_RELATIVE_RANGE requires minimumMultiplier");
                    assertTrue(effect.hasNonNull("maximumMultiplier"), "SET_RELATIVE_RANGE requires maximumMultiplier");
                }
                default -> fail("Unknown operation: " + op);
            }
        }
    }

    private static void validateGrid(final JsonNode grid) {
        final var validGroups = Set.of("FIREPOWER", "VITALITY", "SPECIALIZATION");
        final var validSlots = Set.of(1, 2, 3);
        final var validSides = Set.of("LEFT", "RIGHT");
        assertTrue(validGroups.contains(grid.get("group").asText()), "Invalid grid group: " + grid.get("group"));
        assertTrue(validSlots.contains(grid.get("slot").asInt()), "Invalid grid slot: " + grid.get("slot"));
        assertTrue(validSides.contains(grid.get("side").asText()), "Invalid grid side: " + grid.get("side"));
    }
}
