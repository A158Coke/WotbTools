package com.wotb.web.replay.dto;

import com.wotb.web.replay.dto.BattlePlaybackDataset.Capability;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConfidenceDto;
import com.wotb.web.replay.dto.BattlePlaybackDataset.VehicleBattleLoadoutDto;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

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

    private static BattlePlaybackDataset dataset(final List<String> limitations) {
        // 9-arg convenience constructor：capability 由 limitations 派生。
        return new BattlePlaybackDataset(100, "lagoon", 1, 42L, List.of(), List.of(), List.of(),
                List.of(), limitations);
    }
}
