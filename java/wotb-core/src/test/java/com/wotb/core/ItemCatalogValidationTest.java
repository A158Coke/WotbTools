package com.wotb.core;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

class ItemCatalogValidationTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final Path CATALOG_DIR = Paths.get("").toAbsolutePath().getParent().getParent()
            .resolve("common").resolve("wotb-item-catalog-json");
    private static final JsonNodeFactory NF = JsonNodeFactory.instance;

    @Test
    void equipmentJsonIsValid() throws Exception {
        final var items = requireItems("equipment.json");
        final Set<Integer> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        int idx = 0;
        for (final var item : items) {
            assertTrue(item.isObject(), "equipment[" + idx + "] must be object");
            final int id = requireNonNegativeInt(item, "id", "Equipment[" + idx + "]");
            assertTrue(ids.add(id), "Duplicate equipment id: " + id);
            requireNonBlankText(item, "code", "Equipment[" + idx + "]");
            assertTrue(codes.add(item.get("code").textValue()));
            validateGrid(item.get("grid"), "Equipment[" + idx + "]");
            validateEffects(item.get("effects"), "Equipment[" + idx + "]");
            idx++;
        }
    }

    @Test
    void consumablesJsonIsValid() throws Exception {
        final var items = requireItems("consumables.json");
        final Set<Integer> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        int idx = 0;
        for (final var item : items) {
            assertTrue(item.isObject(), "consumables[" + idx + "] must be object");
            final int id = requireNonNegativeInt(item, "id", "Consumable[" + idx + "]");
            assertTrue(ids.add(id), "Duplicate consumable id: " + id);
            requireNonBlankText(item, "code", "Consumable[" + idx + "]");
            assertTrue(codes.add(item.get("code").textValue()));
            final String activationType = requireNonBlankText(item, "activationType", "Consumable[" + idx + "]");
            assertTrue(Set.of("INSTANT", "DURATION").contains(activationType),
                    "Consumable[" + idx + "] invalid activationType: " + activationType);
            requirePositiveInt(item, "cooldownSeconds", "Consumable[" + idx + "]");
            if ("DURATION".equals(activationType)) {
                requirePositiveInt(item, "durationSeconds", "Consumable[" + idx + "]");
            } else {
                assertFalse(item.hasNonNull("durationSeconds"),
                        "Consumable[" + idx + "] INSTANT must not define non-null durationSeconds");
            }
            validateEffects(item.get("effects"), "Consumable[" + idx + "]");
            idx++;
        }
    }

    @Test
    void provisionsJsonIsValid() throws Exception {
        final var items = requireItems("provisions.json");
        final Set<String> ids = new HashSet<>();
        final Set<String> codes = new HashSet<>();
        final Set<Integer> allSourceIds = new HashSet<>();
        int idx = 0;
        for (final var item : items) {
            assertTrue(item.isObject(), "provisions[" + idx + "] must be object");
            final String pid = requireNonBlankText(item, "id", "Provision[" + idx + "]");
            assertTrue(ids.add(pid), "Duplicate provision id: " + pid);
            requireNonBlankText(item, "code", "Provision[" + idx + "]");
            assertTrue(codes.add(item.get("code").textValue()));
            final JsonNode sourceIds = item.get("sourceIds");
            assertNotNull(sourceIds, "Provision[" + idx + "] missing sourceIds");
            assertTrue(sourceIds.isArray(), "Provision[" + idx + "] sourceIds must be array");
            assertFalse(sourceIds.isEmpty(), "Provision[" + idx + "] sourceIds must not be empty");
            for (final var sid : sourceIds) {
                assertTrue(sid.isIntegralNumber() && sid.canConvertToInt(),
                        "Provision[" + idx + "] sourceId must be valid int");
                final int sourceId = sid.intValue();
                assertTrue(sourceId >= 0, "Provision[" + idx + "] sourceId must be non-negative");
                assertTrue(allSourceIds.add(sourceId), "Duplicate sourceId: " + sourceId);
            }
            validateEffects(item.get("effects"), "Provision[" + idx + "]");
            idx++;
        }
    }

    // ======== Schema helper unit tests ========

    @Test
    void setStringValueAllowed() {
        var effect = obj("operation", "SET", "value", "abc");
        assertDoesNotThrow(() -> validateEffects(array(effect), "test"));
    }

    @Test
    void setObjectValueAllowed() {
        var effect = obj("operation", "SET", "value", obj());
        assertDoesNotThrow(() -> validateEffects(array(effect), "test"));
    }

    @Test
    void instantWithNonNullDurationFails() {
        var item = obj("id", 1, "code", "X", "activationType", "INSTANT",
                "cooldownSeconds", 10, "effects", array(), "durationSeconds", 5);
        assertThrows(AssertionError.class, () -> validateConsumableItem(item, "test"));
    }

    @Test
    void itemIsStringFails() {
        assertThrows(AssertionError.class, () -> requireNonBlankText(NF.textNode("x"), "field", "ctx"));
    }

    @Test
    void itemIsArrayFails() {
        assertThrows(AssertionError.class, () -> requireNonBlankText(array(), "field", "ctx"));
    }

    @Test
    void activationTypeMissingFails() {
        var item = obj("id", 1, "code", "X", "cooldownSeconds", 10, "effects", array());
        assertThrows(AssertionError.class, () -> requireNonBlankText(item, "activationType", "test"));
    }

    @Test
    void sourceIdsNotArrayFails() {
        var item = obj("id", "p1", "code", "X", "sourceIds", "not-an-array", "effects", array());
        assertThrows(AssertionError.class, () -> validateProvisionItem(item, "test"));
    }

    @Test
    void gridNotObjectFails() {
        assertThrows(AssertionError.class, () -> validateGrid(NF.textNode("x"), "test"));
    }

    @Test
    void multiplyNumericValuePasses() {
        var effect = obj("operation", "MULTIPLY", "value", 0.95);
        assertDoesNotThrow(() -> validateEffects(array(effect), "test"));
    }

    @Test
    void setNumericValuePasses() {
        var effect = obj("operation", "SET", "value", true);
        assertDoesNotThrow(() -> validateEffects(array(effect), "test"));
    }

    // ======== Schema helpers ========

    private static void validateConsumableItem(final JsonNode item, final String context) {
        assertTrue(item.isObject(), context + " must be object");
        requireNonBlankText(item, "activationType", context);
        if ("DURATION".equals(item.get("activationType").textValue())) {
            requirePositiveInt(item, "durationSeconds", context);
        } else {
            assertFalse(item.has("durationSeconds"), context + " INSTANT must not define durationSeconds");
        }
    }

    private static void validateProvisionItem(final JsonNode item, final String context) {
        assertTrue(item.isObject(), context + " must be object");
        final JsonNode sourceIds = item.get("sourceIds");
        assertNotNull(sourceIds, context + " missing sourceIds");
        assertTrue(sourceIds.isArray(), context + " sourceIds must be array");
    }

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

    private static double requireFiniteNumber(final JsonNode object, final String field, final String context) {
        final JsonNode node = object.get(field);
        assertNotNull(node, context + " missing " + field);
        assertTrue(node.isNumber(), context + " " + field + " must be numeric");
        final double value = node.doubleValue();
        assertTrue(Double.isFinite(value), context + " " + field + " must be finite");
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
                    requireFiniteNumber(effect, "value", context + " " + operation);
                }
                case "SET" -> {
                    final JsonNode v = effect.get("value");
                    assertNotNull(v, context + " SET missing value");
                }
                case "INSTANT_ACTION" ->
                    requireNonBlankText(effect, "action", context + " INSTANT_ACTION");
                case "SET_RELATIVE_RANGE" -> {
                    final double min = requireFiniteNumber(effect, "minimumMultiplier", context + " SET_RELATIVE_RANGE");
                    final double max = requireFiniteNumber(effect, "maximumMultiplier", context + " SET_RELATIVE_RANGE");
                    assertTrue(min <= max, context + " minimumMultiplier must not exceed maximumMultiplier");
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

    // ======== In-memory JSON factories for unit tests ========

    private static ObjectNode obj(final Object... pairs) {
        var n = NF.objectNode();
        for (int i = 0; i < pairs.length; i += 2) {
            String key = (String) pairs[i];
            Object val = pairs[i + 1];
            if (val instanceof String s) n.put(key, s);
            else if (val instanceof Integer v) n.put(key, v);
            else if (val instanceof Double v) n.put(key, v);
            else if (val instanceof Boolean v) n.put(key, v);
            else if (val instanceof JsonNode v) n.set(key, v);
        }
        return n;
    }

    private static JsonNode array(final JsonNode... items) {
        var a = NF.arrayNode();
        for (var item : items) a.add(item);
        return a;
    }
}
