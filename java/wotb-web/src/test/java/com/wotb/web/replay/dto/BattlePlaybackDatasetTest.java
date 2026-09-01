package com.wotb.web.replay.dto;

import com.wotb.web.replay.dto.BattlePlaybackDataset.Capability;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConfidenceDto;
import com.wotb.web.replay.dto.BattlePlaybackDataset.VehicleBattleLoadoutDto;
import com.wotb.web.replay.dto.BattlePlaybackDataset.VehiclePlaybackTrack;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.StreamSupport;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** BattlePlaybackDataset capability 派生契约（与 limitations 严格一致，前端据此显示降级）。 */
class BattlePlaybackDatasetTest {

    @Test
    void limitationsEmptyDerivesFull() {
        final BattlePlaybackDataset ds = dataset(List.of());
        assertEquals(Capability.FULL, ds.capability());
    }

    @Test
    void limitationsNonEmptyDerivesPartial() {
        final BattlePlaybackDataset ds = dataset(List.of("BATTLE_RELATIVE_TIME_UNAVAILABLE"));
        assertEquals(Capability.PARTIAL, ds.capability());
    }

    @Test
    void explicitCapabilityWinsAndCompatibilityWithOldJsonNullCapability() {
        // 旧缓存 JSON 反序列化时 capability=null（限流），由 limitations 派生。
        final BattlePlaybackDataset ds = new BattlePlaybackDataset(
                100, "lagoon", 1, 42L, List.of(), List.of(), List.of(), List.of(),
                List.of("SOME_LIMITATION"), null);
        assertEquals(Capability.PARTIAL, ds.capability());
        assertNotNull(ds.limitations());
    }

    @Test
    void loadoutToleratesNullWireCodesAndLogicalItemsWithListCopyOf() {
        // 契约：logicalItemId / wireCode / equipmentId 可为 null（unknown raw-preserve）。
        // 回归：List.copyOf 拒绝 null 元素 → NPE → BattlePlaybackProjector 崩 → V2 整个 204。
        final VehicleBattleLoadoutDto dto = new VehicleBattleLoadoutDto(
                "11.19",
                Arrays.asList(null, "consumable-b", null),
                Arrays.asList(1, null, 3),
                Arrays.asList(null, "provision-b", null),
                Arrays.asList(1, null, 3),
                Arrays.asList(100, null, 300),
                ConfidenceDto.HIGH);
        // list 保留 null（不可变、允许 null 元素），不再抛 NPE。
        assertEquals(3, dto.consumables().size());
        assertEquals(3, dto.provisionWireCodes().size());
        assertNull(dto.consumableWireCodes().get(1));
    }

    @Test
    void loadoutNullListsBecomeEmptyImmutableLists() {
        final VehicleBattleLoadoutDto dto = new VehicleBattleLoadoutDto(
                "11.19", null, null, null, null, null, null);
        assertEquals(List.of(), dto.consumables());
        assertEquals(List.of(), dto.provisionWireCodes());
    }

    @Test
    void loadoutConfidenceUsesPlaybackWireVocabulary() {
        final VehicleBattleLoadoutDto dto = new VehicleBattleLoadoutDto(
                "11.19", null, null, null, null, null, ConfidenceDto.HIGH);
        assertEquals(ConfidenceDto.HIGH, dto.confidence());
    }

    @Test
    void serializedLoadoutUsesPlaybackConfidenceValue() throws Exception {
        final VehicleBattleLoadoutDto dto = new VehicleBattleLoadoutDto(
                "11.19", null, null, null, null, null, ConfidenceDto.HIGH);
        final String json = JsonMapper.builder().build().writeValueAsString(dto);
        assertEquals("HIGH", JsonMapper.builder().build().readTree(json).get("confidence").asString());
    }

    @Test
    void jacksonSerializationPreservesNullableLoadoutSlotsAndWireConfidenceVocabulary() throws Exception {
        final ObjectMapper objectMapper = JsonMapper.builder().build();
        final VehicleBattleLoadoutDto loadout = new VehicleBattleLoadoutDto(
                "11.19",
                Arrays.asList(null, "consumable-b", null),
                Arrays.asList(1, null, 3),
                Arrays.asList(null, "provision-b", null),
                Arrays.asList(1, null, 3),
                Arrays.asList(100, null, 300),
                ConfidenceDto.UNKNOWN);
        final VehiclePlaybackTrack vehicle = new VehiclePlaybackTrack(
                42L, "Player", 1001L, "Tank", "medium", 8, 1, true, loadout,
                List.of(), List.of(), List.of(
                        new BattlePlaybackDataset.HealthTransition(
                                0, 100, "CURRENT", "EXACT_BATTLE_EVENT", 100, ConfidenceDto.HIGH),
                        new BattlePlaybackDataset.HealthTransition(
                                1, 90, "CURRENT", "EXACT_BATTLE_EVENT", 100, ConfidenceDto.MEDIUM),
                        new BattlePlaybackDataset.HealthTransition(
                                2, 80, "CURRENT", "EXACT_BATTLE_EVENT", 100, ConfidenceDto.LOW),
                        new BattlePlaybackDataset.HealthTransition(
                                3, 70, "UNKNOWN", "UNKNOWN", null, ConfidenceDto.UNKNOWN)),
                List.of(), List.of(), List.of());
        final BattlePlaybackDataset dataset = new BattlePlaybackDataset(
                100, "lagoon", 1, 42L, List.of(vehicle), List.of(), List.of(), List.of(),
                List.of(), Capability.FULL, 0);

        final JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(dataset));
        assertFieldNames(json, Set.of("durationSec", "mapCode", "friendlyTeam", "recorderAccountId",
                "vehicles", "events", "shots", "pointsSamples", "limitations", "capability", "arenaBonusType"));
        final JsonNode vehicles = requiredField(json, "vehicles");
        assertTrue(vehicles.isArray());
        final JsonNode serializedVehicle = vehicles.get(0);
        assertNotNull(serializedVehicle);
        assertFieldNames(serializedVehicle, Set.of("accountId", "playerName", "tankId", "tankName",
                "tankClass", "tankTier", "team", "friendly", "loadout", "positionSegments",
                "orientationSegments", "healthTransitions", "lifeTransitions", "consumableTransitions",
                "moduleCrewTransitions"));
        final JsonNode serializedLoadout = requiredField(serializedVehicle, "loadout");
        assertFieldNames(serializedLoadout, Set.of("replayVersion", "consumables", "consumableWireCodes",
                "provisions", "provisionWireCodes", "equipmentIds", "confidence"));
        final JsonNode healthTransitions = requiredField(serializedVehicle, "healthTransitions");
        assertFieldNames(healthTransitions.get(0),
                Set.of("timeSec", "currentHp", "knowledge", "source", "displayCapacityHp", "confidence"));

        assertEquals("UNKNOWN", requiredField(serializedLoadout, "confidence").asText());
        assertNullSlot(serializedLoadout, "consumables", 0);
        assertNullSlot(serializedLoadout, "consumableWireCodes", 1);
        assertNullSlot(serializedLoadout, "provisions", 0);
        assertNullSlot(serializedLoadout, "provisionWireCodes", 1);
        assertNullSlot(serializedLoadout, "equipmentIds", 1);

        final Set<String> confidenceValues = StreamSupport.stream(
                        healthTransitions.spliterator(), false)
                .map(transition -> requiredField(transition, "confidence").asText())
                .collect(java.util.stream.Collectors.toSet());
        assertEquals(Set.of("HIGH", "MEDIUM", "LOW", "UNKNOWN"), confidenceValues);
    }

    private static JsonNode requiredField(final JsonNode object, final String field) {
        assertNotNull(object, "serialized contract node is missing before reading " + field);
        final JsonNode value = object.get(field);
        assertNotNull(value, "serialized contract field is missing: " + field);
        return value;
    }

    private static void assertNullSlot(final JsonNode object, final String field, final int index) {
        final JsonNode list = requiredField(object, field);
        assertTrue(list.isArray(), "serialized contract field is not an array: " + field);
        final JsonNode slot = list.get(index);
        assertNotNull(slot, "serialized contract slot is missing: " + field + "[" + index + "]");
        assertTrue(slot.isNull(), "serialized contract slot must preserve null: " + field + "[" + index + "]");
    }

    private static void assertFieldNames(final JsonNode object, final Set<String> expected) {
        assertNotNull(object, "serialized contract object is missing");
        final Set<String> actual = new HashSet<>();
        object.properties().forEach(entry -> actual.add(entry.getKey()));
        assertEquals(expected, actual);
    }

    private static BattlePlaybackDataset dataset(final List<String> limitations) {
        // 9-arg convenience constructor：capability 由 limitations 派生。
        return new BattlePlaybackDataset(100, "lagoon", 1, 42L, List.of(), List.of(), List.of(),
                List.of(), limitations);
    }
}
