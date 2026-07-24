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

class ItemCatalogValidationTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final Path CATALOG_DIR = Paths.get("").toAbsolutePath().getParent().getParent()
            .resolve("common").resolve("wotb-item-catalog-json");

    @Test
    void equipmentJsonIsValid() throws Exception {
        final var items = requireItems("equipment.json");
        final Set<Integer> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        for (final var item : items) {
            final int id = requireNonNegativeInt(item, "id", "Equipment");
            assertTrue(ids.add(id), "Duplicate equipment id: " + id);
            requireNonBlankText(item, "code", "Equipment " + id);
            assertTrue(codes.add(item.get("code").textValue()));
            validateGrid(item.get("grid"), "Equipment " + id);
            validateEffects(item.get("effects"), "Equipment " + id);
        }
    }

    @Test
    void consumablesJsonIsValid() throws Exception {
        final var items = requireItems("consumables.json");
        final Set<Integer> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        for (final var item : items) {
            final int id = requireNonNegativeInt(item, "id", "Consumable");
            assertTrue(ids.add(id), "Duplicate consumable id: " + id);
            requireNonBlankText(item, "code", "Consumable " + id);
            assertTrue(codes.add(item.get("code").textValue()));
            final String activationType = requireNonBlankText(item, "activationType", "Consumable " + id);
            assertTrue(Set.of("INSTANT", "DURATION").contains(activationType),
                    "Consumable " + id + " invalid activationType: " + activationType);
            requirePositiveInt(item, "cooldownSeconds", "Consumable " + id);
            if ("DURATION".equals(activationType)) {
                requirePositiveInt(item, "durationSeconds", "Consumable " + id);
            } else {
                assertFalse(item.hasNonNull("durationSeconds"),
                        "Consumable " + id + " INSTANT must not define durationSeconds");
            }
            validateEffects(item.get("effects"), "Consumable " + id);
        }
    }

    @Test
    void provisionsJsonIsValid() throws Exception {
        final var items = requireItems("provisions.json");
        final Set<String> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        final Set<Integer> allSourceIds = new HashSet<>();
        for (final var item : items) {
            final String pid = requireNonBlankText(item, "id", "Provision");
            assertTrue(ids.add(pid), "Duplicate provision id: " + pid);
            requireNonBlankText(item, "code", "Provision " + pid);
            assertTrue(codes.add(item.get("code").textValue()));
            final JsonNode sourceIds = item.get("sourceIds");
            assertNotNull(sourceIds, "Provision " + pid + " missing sourceIds");
            assertTrue(sourceIds.isArray(), "Provision " + pid + " sourceIds must be array");
            assertFalse(sourceIds.isEmpty(), "Provision " + pid + " sourceIds must not be empty");
            for (final var sid : sourceIds) {
                assertTrue(sid.isIntegralNumber() && sid.canConvertToInt(),
                        "Provision " + pid + " sourceId must be valid int");
                final int sourceId = sid.intValue();
                assertTrue(sourceId >= 0, "Provision " + pid + " sourceId must be non-negative");
                assertTrue(allSourceIds.add(sourceId), "Duplicate sourceId: " + sourceId);
            }
            validateEffects(item.get("effects"), "Provision " + pid);
        }
    }

    // ======== Schema helpers ========

    private static JsonNode requireItems(final String fileName) throws Exception {
        final JsonNode root = load(fileName);
        assertNotNull(root, fileName + " root is null");
        assertTrue(root.isObject(), fileName + " root must be object");
        final JsonNode items = root.get("items");
        assertNotNull(items, fileName + " missing items");
        assertTrue(items.isArray(), fileName + " items must be array");
        assertFalse(items.isEmpty(), fileName + " items must not be empty");
        return items;
    }

    private static String requireNonBlankText(final JsonNode object, final String field, final String context) {
        assertNotNull(object, context + " object is null");
        assertTrue(object.isObject(), context + " must be object");
        final JsonNode node = object.get(field);
        assertNotNull(node, context + " missing " + field);
        assertTrue(node.isTextual(), context + " " + field + " must be string");
        final String value = node.textValue();
        assertFalse(value.isBlank(), context + " " + field + " must not be blank");
        return value;
    }

    private static int requireNonNegativeInt(final JsonNode object, final String field, final String context) {
        final JsonNode node = object.get(field);
        assertNotNull(node, context + " missing " + field);
        assertTrue(node.isIntegralNumber(), context + " " + field + " must be integer");
        assertTrue(node.canConvertToInt(), context + " " + field + " outside int range");
        final int value = node.intValue();
        assertTrue(value >= 0, context + " " + field + " must be non-negative");
        return value;
    }

    private static int requirePositiveInt(final JsonNode object, final String field, final String context) {
        final int value = requireNonNegativeInt(object, field, context);
        assertTrue(value > 0, context + " " + field + " must be positive");
        return value;
    }

    private static void validateGrid(final JsonNode grid, final String context) {
        assertNotNull(grid, context + " missing grid");
        assertTrue(grid.isObject(), context + " grid must be object");
        final String group = requireNonBlankText(grid, "group", context + " grid");
        final String side = requireNonBlankText(grid, "side", context + " grid");
        final int slot = requireNonNegativeInt(grid, "slot", context + " grid");
        assertTrue(Set.of("FIREPOWER", "VITALITY", "SPECIALIZATION").contains(group),
                context + " invalid grid group: " + group);
        assertTrue(Set.of(1, 2, 3).contains(slot), context + " invalid grid slot: " + slot);
        assertTrue(Set.of("LEFT", "RIGHT").contains(side), context + " invalid grid side: " + side);
    }

    private static void validateEffects(final JsonNode effects, final String context) {
        assertNotNull(effects, context + " missing effects");
        assertTrue(effects.isArray(), context + " effects must be array");
        assertFalse(effects.isEmpty(), context + " effects must not be empty");
        for (final var effect : effects) {
            assertTrue(effect.isObject(), context + " effect must be object");
            final String operation = requireNonBlankText(effect, "operation", context + " effect");
            switch (operation) {
                case "MULTIPLY", "ADD", "ADD_PERCENTAGE_POINTS" -> {
                    final JsonNode value = effect.get("value");
                    assertNotNull(value, context + " " + operation + " missing value");
                    assertTrue(value.isNumber(), context + " " + operation + " value must be numeric");
                    assertTrue(Double.isFinite(value.doubleValue()), context + " " + operation + " value must be finite");
                }
                case "SET" -> {
                    final JsonNode value = effect.get("value");
                    assertNotNull(value, context + " SET missing value");
                }
                case "INSTANT_ACTION" ->
                    requireNonBlankText(effect, "action", context + " INSTANT_ACTION");
                case "SET_RELATIVE_RANGE" -> {
                    final JsonNode min = effect.get("minimumMultiplier");
                    final JsonNode max = effect.get("maximumMultiplier");
                    assertNotNull(min, context + " SET_RELATIVE_RANGE missing minimumMultiplier");
                    assertNotNull(max, context + " SET_RELATIVE_RANGE missing maximumMultiplier");
                    assertTrue(min.isNumber(), context + " minimumMultiplier must be numeric");
                    assertTrue(max.isNumber(), context + " maximumMultiplier must be numeric");
                    assertTrue(Double.isFinite(min.doubleValue()), context + " minimumMultiplier must be finite");
                    assertTrue(Double.isFinite(max.doubleValue()), context + " maximumMultiplier must be finite");
                    assertTrue(min.doubleValue() <= max.doubleValue(),
                            context + " minimumMultiplier must not exceed maximumMultiplier");
                }
                default -> fail(context + " unknown operation: " + operation);
            }
        }
    }

    private static JsonNode load(final String fileName) throws Exception {
        final File file = CATALOG_DIR.resolve(fileName).toFile();
        assertTrue(file.exists(), "File not found: " + file);
        return MAPPER.readTree(file);
    }
}
