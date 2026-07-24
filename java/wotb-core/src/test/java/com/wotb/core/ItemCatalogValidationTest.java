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
            validateEquipmentItem(item, idx, ids, codes);
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
            validateConsumableItem(item, idx, ids, codes);
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
            validateProvisionItem(item, idx, ids, codes, allSourceIds);
            idx++;
        }
    }

    // ======== Schema helper unit tests ========

    @Test void setMissingValueFails() { assertThrows(AssertionError.class, () -> validateEffects(array(obj("operation", "SET")), "t")); }
    @Test void setBooleanValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "SET", "value", true)), "t")); }
    @Test void setStringValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "SET", "value", "x")), "t")); }
    @Test void setObjectValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "SET", "value", obj())), "t")); }
    @Test void setNumericValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "SET", "value", 1)), "t")); }
    @Test void setDoubleValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "SET", "value", 0.75)), "t")); }
    @Test void setNegativeValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "SET", "value", -2.5)), "t")); }
    @Test void addValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "ADD", "value", 10)), "t")); }
    @Test void multiplyValuePasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "MULTIPLY", "value", 0.95)), "t")); }
    @Test void addPercentagePointsPasses() { assertDoesNotThrow(() -> validateEffects(array(obj("operation", "ADD_PERCENTAGE_POINTS", "value", 5)), "t")); }

    @Test void instantWithNullDurationPasses() {
        var item = obj("id", 1, "code", "X", "activationType", "INSTANT",
                "cooldownSeconds", 10, "effects", array(obj("operation", "MULTIPLY", "value", 0.5)));
        item.set("durationSeconds", NF.nullNode());
        assertDoesNotThrow(() -> validateConsumableItem(item, 0, new HashSet<>(), new HashSet<>()));
    }

    @Test void instantWithNonNullDurationFails() {
        var item = obj("id", 1, "code", "X", "activationType", "INSTANT",
                "cooldownSeconds", 10, "effects", array(obj("operation", "MULTIPLY", "value", 0.5)), "durationSeconds", 5);
        assertThrows(AssertionError.class,
                () -> validateConsumableItem(item, 0, new HashSet<>(), new HashSet<>()));
    }

    @Test void itemIsStringFails() { assertThrows(AssertionError.class, () -> requireNonBlankText(NF.textNode("x"), "f", "c")); }
    @Test void itemIsArrayFails() { assertThrows(AssertionError.class, () -> requireNonBlankText(array(), "f", "c")); }
    @Test void activationTypeMissingFails() {
        assertThrows(AssertionError.class,
                () -> validateConsumableItem(obj("id", 1, "code", "X", "cooldownSeconds", 10, "effects",
                        array(obj("operation", "MULTIPLY", "value", 0.5))),
                        0, new HashSet<>(), new HashSet<>()));
    }
    @Test void sourceIdsNotArrayFails() {
        assertThrows(AssertionError.class,
                () -> validateProvisionItem(obj("id", "p", "code", "X", "sourceIds", "x", "effects",
                        array(obj("operation", "MULTIPLY", "value", 0.5))),
                        0, new HashSet<>(), new HashSet<>(), new HashSet<>()));
    }
    @Test void gridNotObjectFails() { assertThrows(AssertionError.class, () -> validateGrid(NF.textNode("x"), "t")); }
    @Test void durationPositiveInt() {
        var item = obj("id", 1, "code", "X", "activationType", "DURATION",
                "cooldownSeconds", 10, "durationSeconds", 30, "effects",
                array(obj("operation", "MULTIPLY", "value", 0.5)));
        assertDoesNotThrow(() -> validateConsumableItem(item, 0, new HashSet<>(), new HashSet<>()));
    }

    // ======== Item validators ========

    private static void validateEquipmentItem(final JsonNode item, final int idx,
            final Set<Integer> ids, final Set<String> codes) {
        assertTrue(item.isObject(), "equipment[" + idx + "] must be object");
        final int id = requireNonNegativeInt(item, "id", "equipment[" + idx + "]");
        assertTrue(ids.add(id), "Duplicate equipment id: " + id);
        requireNonBlankText(item, "code", "equipment[" + idx + "]");
        assertTrue(codes.add(item.get("code").textValue()));
        validateGrid(item.get("grid"), "equipment[" + idx + "]");
        validateEffects(item.get("effects"), "equipment[" + idx + "]");
    }

    private static void validateConsumableItem(final JsonNode item, final int idx,
            final Set<Integer> ids, final Set<String> codes) {
        assertTrue(item.isObject(), "consumables[" + idx + "] must be object");
        final int id = requireNonNegativeInt(item, "id", "consumables[" + idx + "]");
        assertTrue(ids.add(id), "Duplicate consumable id: " + id);
        requireNonBlankText(item, "code", "consumables[" + idx + "]");
        assertTrue(codes.add(item.get("code").textValue()));
        final String activationType = requireNonBlankText(item, "activationType", "consumables[" + idx + "]");
        assertTrue(Set.of("INSTANT", "DURATION").contains(activationType),
                "consumables[" + idx + "] invalid activationType: " + activationType);
        requirePositiveInt(item, "cooldownSeconds", "consumables[" + idx + "]");
        if ("DURATION".equals(activationType)) {
            requirePositiveInt(item, "durationSeconds", "consumables[" + idx + "]");
        } else {
            assertFalse(item.hasNonNull("durationSeconds"),
                    "consumables[" + idx + "] INSTANT must not define non-null durationSeconds");
        }
        validateEffects(item.get("effects"), "consumables[" + idx + "]");
    }

    private static void validateProvisionItem(final JsonNode item, final int idx,
            final Set<String> ids, final Set<String> codes, final Set<Integer> allSourceIds) {
        assertTrue(item.isObject(), "provisions[" + idx + "] must be object");
        final String pid = requireNonBlankText(item, "id", "provisions[" + idx + "]");
        assertTrue(ids.add(pid), "Duplicate provision id: " + pid);
        requireNonBlankText(item, "code", "provisions[" + idx + "]");
        assertTrue(codes.add(item.get("code").textValue()));
        final JsonNode sourceIds = item.get("sourceIds");
        assertNotNull(sourceIds, "provisions[" + idx + "] missing sourceIds");
        assertTrue(sourceIds.isArray(), "provisions[" + idx + "] sourceIds must be array");
        assertFalse(sourceIds.isEmpty(), "provisions[" + idx + "] sourceIds must not be empty");
        for (final var sid : sourceIds) {
            assertTrue(sid.isIntegralNumber() && sid.canConvertToInt(),
                    "provisions[" + idx + "] sourceId must be valid int");
            final int sourceId = sid.intValue();
            assertTrue(sourceId >= 0, "provisions[" + idx + "] sourceId must be non-negative");
            assertTrue(allSourceIds.add(sourceId), "Duplicate sourceId: " + sourceId);
        }
        validateEffects(item.get("effects"), "provisions[" + idx + "]");
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
        final int v = requireNonNegativeInt(object, field, context);
        assertTrue(v > 0, context + " " + field + " must be positive");
        return v;
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
                case "MULTIPLY", "ADD", "ADD_PERCENTAGE_POINTS" ->
                    requireFiniteNumber(effect, "value", context + " " + operation);
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

    // ======== In-memory JSON factories ========

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
