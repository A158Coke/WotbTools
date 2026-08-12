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
    void verifiedSourceAndAreaConfidenceArePreserved() {
        final MapTacticalSemantics semantics = registry.semanticsFor("desert_train");
        assertTrue(semantics.verified(), "map semantics are human-verified since 2026-08-12");
        assertEquals("CLIENT_RESOURCE_DERIVED", semantics.source());
        assertEquals("Desert Sands", semantics.displayName());
        final MapTacticalSemantics.AreaConfidence confidence =
                semantics.areas().get("HARD_COVER_ZONE_01").confidence();
        assertEquals("EXACT_CLIENT_DATA", confidence.geometry());
        assertEquals("EXACT_CLIENT_DATA", confidence.objectPositions());
        assertEquals("NAME_HEURISTIC", confidence.objectCategories());
        assertEquals("GRID_RULE_DERIVED", confidence.areaBoundary());
        assertEquals("RULE_DERIVED_CANDIDATE", confidence.favorsAndRisks());
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
        final List<MapTacticalSemantics.TacticalRelationship> relationships =
                semantics.relationships();
        // ADJACENT_TO 原样保留（不改成 connects），reason/confidence 完整
        assertTrue(relationships.stream().anyMatch(rel ->
                rel.from().equals("ELEVATED_TERRAIN_02")
                        && rel.type().equals("ADJACENT_TO")
                        && rel.to().equals("VEGETATED_TERRAIN_02")
                        && rel.reason().contains("相邻")
                        && rel.confidence().equals("EXACT_GRID_TOPOLOGY")));
        // HIGHER_THAN 原样保留
        assertTrue(relationships.stream().anyMatch(rel ->
                rel.from().equals("ELEVATED_TERRAIN_02")
                        && rel.type().equals("HIGHER_THAN")
                        && rel.to().equals("VEGETATED_TERRAIN_02")));
        // CONTAINS_CONTROL_POINT 与 CONTAINS_STRATEGIC_POINT 不混合
        final List<String> controlPointTos = relationships.stream()
                .filter(rel -> rel.type().equals("CONTAINS_CONTROL_POINT"))
                .map(MapTacticalSemantics.TacticalRelationship::to)
                .toList();
        final List<String> strategicPointTos = relationships.stream()
                .filter(rel -> rel.type().equals("CONTAINS_STRATEGIC_POINT"))
                .map(MapTacticalSemantics.TacticalRelationship::to)
                .toList();
        assertTrue(controlPointTos.contains("Control1"));
        assertTrue(strategicPointTos.contains("1.sc2"));
        assertFalse(controlPointTos.contains("1.sc2"));
        assertFalse(strategicPointTos.contains("Control1"));
        // 每条关系 reason/confidence 均完整
        assertTrue(relationships.stream().allMatch(rel ->
                !rel.reason().isBlank() && !rel.confidence().isBlank()));
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
