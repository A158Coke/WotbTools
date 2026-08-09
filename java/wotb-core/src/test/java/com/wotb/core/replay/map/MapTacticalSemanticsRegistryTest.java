package com.wotb.core.replay.map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import java.util.List;

class MapTacticalSemanticsRegistryTest {

    private final MapTacticalSemanticsRegistry registry = MapTacticalSemanticsRegistry.load();

    @Test
    void desertTrainResolvesFromSemanticizerData() {
        // map-semanticizer 生成的 Desert Sands 语义（common/map-semantics/02_desert_train_dt.semantic.json）
        final MapTacticalSemantics semantics = registry.semanticsFor("desert_train");
        assertTrue(semantics.hasSemantics());
        assertTrue(semantics.areas().containsKey("HARD_COVER_ZONE_01"));
        assertFalse(semantics.areas().get("HARD_COVER_ZONE_01").favors().isEmpty());
        assertTrue(semantics.areas().get("HARD_COVER_ZONE_01").gridRegions()
                .contains("GRID_REGION_3"));
        assertTrue(semantics.areas().get("LINEAR_CORRIDOR_01").gridRegions()
                .contains("GRID_REGION_5"));
    }

    @Test
    void mapIdItselfAndTokenBoundaryAliasBothResolve() {
        assertTrue(registry.semanticsFor("02_desert_train_dt").hasSemantics());
        assertTrue(registry.semanticsFor("desert_train").hasSemantics());
        // 短 token（train）不得被当作内部地图 code
        assertFalse(registry.semanticsFor("train").hasSemantics());
        assertFalse(registry.semanticsFor("02").hasSemantics());
    }

    @Test
    void relationshipsAndSpawnSemanticsAreMapped() {
        final MapTacticalSemantics semantics = registry.semanticsFor("desert_train");
        final MapTacticalSemantics.AreaRelationships relationships =
                semantics.relationships().get("ELEVATED_TERRAIN_02");
        assertTrue(relationships.connects().contains("VEGETATED_TERRAIN_02"));
        assertTrue(relationships.higherThan().contains("VEGETATED_TERRAIN_02"));
        assertTrue(semantics.relationships().values().stream()
                .anyMatch(rel -> !rel.containsPoints().isEmpty()));
        final MapTacticalSemantics.SpawnSemantics team1 = semantics.spawnSemantics().get("TEAM_1");
        assertTrue(team1.areas().contains("MIXED_TERRAIN_04"));
        assertEquals("EXACT_SCENE_DATA", team1.status());
    }

    @Test
    void battleMapsWithSemanticizerDataResolve() {
        for (final String code : List.of(
                "desert_train", "erlenberg", "himmelsdorf", "canyon", "lagoon",
                "canal", "faust", "milbase", "port", "savanna")) {
            assertTrue(registry.semanticsFor(code).hasSemantics(), code + " should resolve");
        }
    }

    @Test
    void mapsWithoutSemanticDataReturnUnknown() {
        assertFalse(registry.semanticsFor("not_a_real_map").hasSemantics());
        assertFalse(registry.semanticsFor(null).hasSemantics());
        assertFalse(registry.semanticsFor("").hasSemantics());
    }

    @Test
    void boundedTokenAliasesSkipShortSingleTokens() {
        assertEquals(List.of(
                        "02_desert", "desert_train", "train_dt",
                        "02_desert_train", "desert_train_dt",
                        "02_desert_train_dt"),
                MapTacticalSemanticsRegistry.boundedTokenAliases("02_desert_train_dt"));
    }
}
