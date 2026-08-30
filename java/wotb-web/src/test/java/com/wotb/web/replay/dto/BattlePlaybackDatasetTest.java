package com.wotb.web.replay.dto;

import com.wotb.web.replay.dto.BattlePlaybackDataset.Capability;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

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

    private static BattlePlaybackDataset dataset(final List<String> limitations) {
        // 9-arg convenience constructor：capability 由 limitations 派生。
        return new BattlePlaybackDataset(100, "lagoon", 1, 42L, List.of(), List.of(), List.of(),
                List.of(), limitations);
    }
}
