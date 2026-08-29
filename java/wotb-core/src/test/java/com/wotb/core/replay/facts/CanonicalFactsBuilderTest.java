package com.wotb.core.replay.facts;

import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.event.ConsumableLifecycleEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import com.wotb.core.replay.event.VehicleModuleCrewStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Canonical facts builders: VehicleLoadoutFacts / ConsumableLifecycle / VehicleModuleCrewLifecycle. */
class CanonicalFactsBuilderTest {

    private static ReplayTimestamp ts(final float raw) {
        return new ReplayTimestamp(raw, null);
    }

    private static TeamEntityMapping mapping() {
        final Map<Integer, TeamEntityIdentity> entities = Map.of(
                7, new TeamEntityIdentity(7, 1001L, "recorder", 123L, "Tank", 1, DecodeConfidence.EXACT),
                9, new TeamEntityIdentity(9, 2002L, "enemy", 456L, "Enemy", 2, DecodeConfidence.EXACT));
        final Map<Long, List<Integer>> byAccount = Map.of(
                1001L, List.of(7),
                2002L, List.of(9));
        return new TeamEntityMapping(entities, byAccount, Map.of(), 0, List.of());
    }

    private static VehicleBattleLoadout loadout(final int eid) {
        final VehicleBattleLoadout.LoadoutItemSlot con =
                new VehicleBattleLoadout.LoadoutItemSlot(0, 0x09, 1,
                        new byte[12], "ADRENALINE", DecodeConfidence.EXACT);
        final VehicleBattleLoadout.LoadoutItemSlot prov =
                new VehicleBattleLoadout.LoadoutItemSlot(3, 0x44, 1,
                        new byte[12], "SANDBAG_ARMOR", DecodeConfidence.EXACT);
        final VehicleBattleLoadout.EquipmentSelection eq =
                new VehicleBattleLoadout.EquipmentSelection(0, 100, (byte) 100);
        return new VehicleBattleLoadout(eid, "11.19.0_china",
                List.of(con, con, con), List.of(prov, prov, prov),
                List.of(eq, eq, eq, eq, eq, eq, eq, eq, eq), DecodeConfidence.EXACT);
    }

    @Test
    void loadoutFacts_KnownAfterMaterialize_StaysKnownAfterAoiLeave() {
        final MaterializationEvent mat = new MaterializationEvent(
                1, ts(90f), 5, DecodeConfidence.EXACT, 9, 2, 1200, new byte[8], new byte[8],
                loadout(9));
        final Map<Long, List<VehicleLoadoutFacts.LoadoutObservation>> byAccount =
                VehicleLoadoutFacts.build(List.of(mat), mapping(), 0.0);
        final long enemy = 2002L;
        // t=50: before materialization -> not known
        assertFalse(VehicleLoadoutFacts.knownAtOrBefore(byAccount, enemy, 50));
        assertNull(VehicleLoadoutFacts.loadoutAtOrBefore(byAccount, enemy, 50));
        // t=90: materialized -> known
        assertTrue(VehicleLoadoutFacts.knownAtOrBefore(byAccount, enemy, 90));
        // t=200: after leave/re-enter cycles, loadout stays known (persistent config)
        assertTrue(VehicleLoadoutFacts.knownAtOrBefore(byAccount, enemy, 200));
        assertNotNull(VehicleLoadoutFacts.loadoutAtOrBefore(byAccount, enemy, 200));
    }

    @Test
    void consumableLifecycle_IndexesProvenAndUnknownWire() {
        final ConsumableLifecycleEvent known = new ConsumableLifecycleEvent(
                1, ts(95f), 32, DecodeConfidence.EXACT, 9, 95f, 0x0D, "REPAIR_KIT",
                ConsumableLifecycleEvent.ConsumableLifecycleState.ACTIVATED, 0, 0f);
        final ConsumableLifecycleEvent unknownWire = new ConsumableLifecycleEvent(
                2, ts(96f), 32, DecodeConfidence.PARTIAL, 9, 96f, 0x77, null,
                ConsumableLifecycleEvent.ConsumableLifecycleState.ACTIVATED, 0, 0f);
        final Map<Long, List<ConsumableLifecycle.ConsumableObservation>> byAccount =
                ConsumableLifecycle.build(List.of(known, unknownWire), mapping(), 0.0);
        final ConsumableLifecycle.ConsumableObservation o =
                ConsumableLifecycle.lastAtOrBefore(byAccount, 2002L, 100);
        assertNotNull(o);
        assertEquals(0x77, o.wireCode());
        assertNull(o.logicalItemId(), "unknown wire preserved as null identity");
        assertEquals(0x0D, ConsumableLifecycle.lastAtOrBefore(byAccount, 2002L, 95.5).wireCode());
    }

    @Test
    void moduleCrew_RecorderVisibleOnlyForRecorderVehicle() {
        final VehicleModuleCrewStateEvent recorderEv = new VehicleModuleCrewStateEvent(
                1, ts(120f), 8, DecodeConfidence.EXACT, 7, 7, 5, 31, 0,
                VehicleModuleCrewStateEvent.Component.ENGINE,
                VehicleModuleCrewStateEvent.State.CRITICAL_DISABLED);
        final VehicleModuleCrewStateEvent enemyEv = new VehicleModuleCrewStateEvent(
                2, ts(121f), 8, DecodeConfidence.EXACT, 9, 9, 5, 32, 0,
                VehicleModuleCrewStateEvent.Component.AMMO_RACK,
                VehicleModuleCrewStateEvent.State.DAMAGED_DEGRADED);
        final Map<Long, List<VehicleModuleCrewLifecycle.ModuleCrewObservation>> byAccount =
                VehicleModuleCrewLifecycle.build(List.of(recorderEv, enemyEv), mapping(), 1001L, 0.0);
        final VehicleModuleCrewLifecycle.ModuleCrewObservation rec =
                VehicleModuleCrewLifecycle.lastAtOrBefore(byAccount, 1001L, 200);
        assertNotNull(rec);
        assertTrue(rec.recorderVisible());
        final VehicleModuleCrewLifecycle.ModuleCrewObservation enemy =
                VehicleModuleCrewLifecycle.lastAtOrBefore(byAccount, 2002L, 200);
        assertNotNull(enemy);
        assertFalse(enemy.recorderVisible(),
                "recorder-visible telemetry must not be presented as team-global module fact");
    }
}
