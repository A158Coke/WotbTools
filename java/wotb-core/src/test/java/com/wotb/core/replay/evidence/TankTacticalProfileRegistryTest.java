package com.wotb.core.replay.evidence;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TankTacticalProfileRegistryTest {

    private final TankTacticalProfileRegistry registry = TankTacticalProfileRegistry.load();

    @Test
    void curatedProfileByExactName() {
        final TankTacticalProfile kran = registry.profileFor(4481, "Kranvagn", "重坦", "10");
        assertTrue(kran.curated());
        assertEquals("HEAVY", kran.vehicleClass());
        assertEquals("HIGH", kran.hullDownAbility());
        assertTrue(kran.roles().contains("hull_down_heavy"));
    }

    @Test
    void curatedMatchIsCaseInsensitive() {
        final TankTacticalProfile lower = registry.profileFor(0, "kranvagn", "重坦", "10");
        assertTrue(lower.curated());
    }

    @Test
    void unknownTankFallsBackToClassDefault() {
        final TankTacticalProfile generic = registry.profileFor(0, "Some Tier 10", "重坦", "10");
        assertFalse(generic.curated());
        assertEquals("HEAVY", generic.vehicleClass());
        assertEquals("HIGH", generic.armorReliability());
    }

    @Test
    void mediumClassDefaultHasHighMobility() {
        final TankTacticalProfile medium = registry.profileFor(0, "T-54", "中坦", "9");
        assertEquals("MEDIUM", medium.vehicleClass());
        assertEquals("HIGH", medium.mobility());
    }

    @Test
    void normalizeClassHandlesChineseAndEnglish() {
        assertEquals("HEAVY", TankTacticalProfileRegistry.normalizeClass("重坦"));
        assertEquals("TANK_DESTROYER", TankTacticalProfileRegistry.normalizeClass("TD"));
        assertEquals("LIGHT", TankTacticalProfileRegistry.normalizeClass("轻坦"));
        assertEquals("UNKNOWN", TankTacticalProfileRegistry.normalizeClass(null));
        assertEquals("HEAVY", TankTacticalProfileRegistry.normalizeClass("Heavy tank"));
        assertEquals("MEDIUM", TankTacticalProfileRegistry.normalizeClass("Medium tank"));
        assertEquals("LIGHT", TankTacticalProfileRegistry.normalizeClass("Light tank"));
        assertEquals("TANK_DESTROYER", TankTacticalProfileRegistry.normalizeClass("Tank destroyer"));
    }

    @Test
    void curatedProfilesContainNoPcWotOrSpgTags() {
        final List<String> banned = List.of(
                "artillery", "arty", "spg", "self.propelled", "self_propelled",
                "gold_dependent", "hull_down_immunity", "absolute_frontline");
        final List<String> violations = new ArrayList<>();
        try (InputStream in = TankTacticalProfileRegistry.class
                .getResourceAsStream("/tank_tactical_profiles.json")) {
            final JsonNode root = JsonMapper.builder().build().readTree(in);
            root.properties().forEach(entry -> {
                final String tank = entry.getKey();
                for (final String field : List.of("roles", "strengths", "weaknesses")) {
                    final JsonNode node = entry.getValue().get(field);
                    if (node == null || !node.isArray()) {
                        continue;
                    }
                    node.forEach(item -> {
                        final String tag = item.asText().toLowerCase();
                        for (final String b : banned) {
                            if (tag.contains(b)) {
                                violations.add(tank + ":" + field + "=" + item.asText());
                            }
                        }
                    });
                }
            });
        } catch (final Exception e) {
            throw new AssertionError("cannot read tank_tactical_profiles.json", e);
        }
        assertTrue(violations.isEmpty(),
                "WoT Blitz 没有自行火炮，禁止 PC WoT / SPG 语义标签进入 Tactical Profile: " + violations);
    }

    @Test
    void everyTier10TankHasCuratedProfile() {
        final TankTacticalProfileRegistry registry = TankTacticalProfileRegistry.load();
        final List<String> missing = new ArrayList<>();
        try (InputStream in = TankTacticalProfileRegistry.class
                .getResourceAsStream("/tankopedia-tier10.json")) {
            final JsonNode root = JsonMapper.builder().build().readTree(in);
            for (final JsonNode vehicle : root.get("vehicles")) {
                final TankTacticalProfile profile = registry.profileFor(
                        vehicle.get("id").asLong(),
                        vehicle.get("name").asText(),
                        vehicle.get("class").asText(),
                        String.valueOf(vehicle.get("tier").asInt()));
                if (!profile.curated()) {
                    missing.add(vehicle.get("name").asText());
                }
            }
        } catch (final Exception e) {
            throw new AssertionError("cannot read tankopedia-tier10.json", e);
        }
        assertTrue(missing.isEmpty(),
                "十级车辆必须全部有 curated Tactical Profile，缺失: " + missing);
    }
}
