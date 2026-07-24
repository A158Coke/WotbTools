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
    // Uses helpers: setEffect, numericEffect, assertInvalid, assertValid

    @Test
    void setMissingValueFails() { assertInvalid(setEffect(null)); }

    @Test
    void setNullValueFails() { assertInvalid(setEffect(NF.nullNode())); }

    @Test
    void setObjectValueFails() { assertInvalid(setEffect(obj())); }

    @Test
    void setArrayValueFails() { assertInvalid(setEffect(array())); }

    @Test
    void setBlankStringValueFails() { assertInvalid(setEffect("   ")); }

    @Test
    void setNonFiniteNumberFails() { assertInvalid(setEffect(NF.numberNode(Double.NaN))); }

    @Test
    void setBinaryValueFails() { assertInvalid(setEffect(NF.binaryNode(new byte[]{1}))); }

    @Test
    void setPojoValueFails() { assertInvalid(setEffect(NF.pojoNode("x"))); }

    @Test
    void setMissingNodeValueFails() { assertInvalid(setEffect(null)); }

    @Test
    void setBooleanValuePasses() { assertValid(setEffect(true)); }

    @Test
    void setStringValuePasses() { assertValid(setEffect("x")); }

    @Test
    void setNumericValuePasses() { assertValid(setEffect(1)); }

    @Test
    void setDoubleValuePasses() { assertValid(setEffect(0.75)); }

    @Test
    void setNegativeValuePasses() { assertValid(setEffect(-2.5)); }

    @Test
    void addMissingStatFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "ADD", "value", 10)), "t"));
    }

    @Test
    void multiplyMissingStatFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "MULTIPLY", "value", 0.95)), "t"));
    }

    @Test
    void setMissingStatFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "SET", "value", true)), "t"));
    }

    @Test
    void addPercentagePointsMissingStatFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "ADD_PERCENTAGE_POINTS", "value", 5)), "t"));
    }

    @Test
    void relativeRangeMissingStatFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "SET_RELATIVE_RANGE",
                        "minimumMultiplier", 0.5, "maximumMultiplier", 1.5)), "t"));
    }

    @Test
    void statNullFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "MULTIPLY", "value", 0.9, "stat", NF.nullNode())), "t"));
    }

    @Test
    void statNonTextualFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "MULTIPLY", "value", 0.9, "stat", NF.numberNode(1))), "t"));
    }

    @Test
    void statBlankFails() {
        assertThrows(AssertionError.class,
                () -> validateEffects(array(obj("operation", "MULTIPLY", "value", 0.9, "stat", "   ")), "t"));
    }

    @Test
    void addWithStatPasses() {
        assertDoesNotThrow(() -> validateEffects(array(obj("operation", "ADD", "value", 10, "stat", "x")), "t"));
    }

    @Test
    void multiplyWithStatPasses() {
        assertDoesNotThrow(() -> validateEffects(array(obj("operation", "MULTIPLY", "value", 0.95, "stat", "x")), "t"));
    }

    @Test
    void addValuePasses() {
        assertDoesNotThrow(() -> validateEffects(array(obj("operation", "ADD", "value", 10, "stat", "x")), "t"));
    }

    @Test
    void multiplyValuePasses() {
        assertDoesNotThrow(() -> validateEffects(array(obj("operation", "MULTIPLY", "value", 0.95, "stat", "x")), "t"));
    }

    @Test
    void addPercentagePointsPasses() {
        assertDoesNotThrow(() -> validateEffects(array(obj("operation", "ADD_PERCENTAGE_POINTS", "value", 5, "stat", "x")), "t"));
    }

    @Test
    void addPercentagePointsWithStatPasses() {
        assertDoesNotThrow(() -> validateEffects(array(obj("operation", "ADD_PERCENTAGE_POINTS", "value", 5, "stat", "x")), "t"));
    }

    @Test
    void relativeRangeWithStatPasses() {
        assertDoesNotThrow(() -> validateEffects(array(obj("operation", "SET_RELATIVE_RANGE",
                "minimumMultiplier", 0.5, "maximumMultiplier", 1.5, "stat", "x")), "t"));
    }

    @Test
    void instantWithoutDurationPasses() {
        var item = obj("id", 1, "code", "X", "activationType", "INSTANT",
                "cooldownSeconds", 10, "effects", array(obj("operation", "MULTIPLY", "value", 0.5, "stat", "x")));
        assertDoesNotThrow(() -> validateConsumableItem(item, 0, new HashSet<>(), new HashSet<>()));
    }

    @Test
    void instantWithNullDurationPasses() {
        var item = obj("id", 1, "code", "X", "activationType", "INSTANT",
                "cooldownSeconds", 10,         "effects", array(obj("operation", "MULTIPLY", "value", 0.5, "stat", "x")));
        item.set("durationSeconds", NF.nullNode());
        assertDoesNotThrow(() -> validateConsumableItem(item, 0, new HashSet<>(), new HashSet<>()));
    }

    @Test
    void instantWithNonNullDurationFails() {
        var item = obj("id", 1, "code", "X", "activationType", "INSTANT",
                "cooldownSeconds", 10, "effects", array(obj("operation", "MULTIPLY", "value", 0.5, "stat", "x")), "durationSeconds", 5);
        assertThrows(AssertionError.class,
                () -> validateConsumableItem(item, 0, new HashSet<>(), new HashSet<>()));
    }

    @Test
    void itemIsStringFails() {
        assertThrows(AssertionError.class,
                () -> requireNonBlankText(NF.textNode("x"), "f", "c"));
    }

    @Test
    void itemIsArrayFails() {
        assertThrows(AssertionError.class,
                () -> requireNonBlankText(array(), "f", "c"));
    }

    @Test
    void activationTypeMissingFails() {
        assertThrows(AssertionError.class,
                () -> validateConsumableItem(obj("id", 1, "code", "X", "cooldownSeconds", 10, "effects",
                        array(obj("operation", "MULTIPLY", "value", 0.5, "stat", "x"))),
                        0, new HashSet<>(), new HashSet<>()));
    }

    @Test
    void sourceIdsNotArrayFails() {
        assertThrows(AssertionError.class,
                () -> validateProvisionItem(obj("id", "p", "code", "X", "sourceIds", "x", "effects",
                        array(obj("operation", "MULTIPLY", "value", 0.5, "stat", "x"))),
                        0, new HashSet<>(), new HashSet<>(), new HashSet<>()));
    }
    @Test
    void gridNotObjectFails() {
        assertThrows(AssertionError.class,
                () -> validateGrid(NF.textNode("x"), "t"));
    }

    @Test
    void durationPositiveInt() {
        var item = obj("id", 1, "code", "X", "activationType", "DURATION",
                "cooldownSeconds", 10, "durationSeconds", 30, "effects",
                array(obj("operation", "MULTIPLY", "value", 0.5, "stat", "x")));
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
                case "MULTIPLY", "ADD", "SET", "ADD_PERCENTAGE_POINTS" -> {
                    requireNonBlankText(effect, "stat", context + " " + operation);
                    if ("SET".equals(operation)) {
                        requireSetScalarValue(effect, "value", context + " SET");
                    } else {
                        requireFiniteNumber(effect, "value", context + " " + operation);
                    }
                }
                case "SET_RELATIVE_RANGE" -> {
                    requireNonBlankText(effect, "stat", context + " SET_RELATIVE_RANGE");
                    requireFiniteNumber(effect, "minimumMultiplier", context + " SET_RELATIVE_RANGE");
                    requireFiniteNumber(effect, "maximumMultiplier", context + " SET_RELATIVE_RANGE");
                    final double min = effect.get("minimumMultiplier").doubleValue();
                    final double max = effect.get("maximumMultiplier").doubleValue();
                    assertTrue(min <= max, context + " minimumMultiplier must not exceed maximumMultiplier");
                }
                case "INSTANT_ACTION" ->
                    requireNonBlankText(effect, "action", context + " INSTANT_ACTION");
                default -> fail(context + " unknown operation: " + operation);
            }
        }
    }

    private static void requireSetScalarValue(final JsonNode object, final String field, final String context) {
        final JsonNode v = object.get(field);
        assertNotNull(v, context + " missing " + field);
        assertTrue(v.isBoolean() || v.isTextual() || v.isNumber(),
                context + " " + field + " must be boolean, string, or number");
        if (v.isTextual()) {
            assertFalse(v.textValue().isBlank(), context + " " + field + " must not be blank string");
        }
        if (v.isNumber()) {
            assertTrue(Double.isFinite(v.doubleValue()), context + " " + field + " must be finite");
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

    // ======== Effect test helpers ========

    /** Create a SET effect with the given raw value node (converted to JsonNode via obj's logic). */
    private static JsonNode setEffect(final Object rawValue) {
        if (rawValue == null) {
            return array(obj("operation", "SET", "stat", "x"));
        }
        return array(obj("operation", "SET", "value", rawValue, "stat", "x"));
    }

    /** Assert that an effect (as a single-element array) fails validateEffects. */
    private static void assertInvalid(final JsonNode effect) {
        assertThrows(AssertionError.class, () -> validateEffects(effect, "t"));
    }

    /** Assert that an effect (as a single-element array) passes validateEffects. */
    private static void assertValid(final JsonNode effect) {
        assertDoesNotThrow(() -> validateEffects(effect, "t"));
    }
}
