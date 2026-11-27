package com.wotb.core.ref;

import com.wotb.core.model.TankInfo;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public final class Tankopedia {

    private static final String[] TIER_RESOURCES = {
            "/tankopedia-tier1.json",
            "/tankopedia-tier2.json",
            "/tankopedia-tier3.json",
            "/tankopedia-tier4.json",
            "/tankopedia-tier5.json",
            "/tankopedia-tier6.json",
            "/tankopedia-tier7.json",
            "/tankopedia-tier8.json",
            "/tankopedia-tier9.json",
            "/tankopedia-tier10.json",
    };

    private final Map<Long, JsonNode> vehicles;
    private final Set<String> names;

    private Tankopedia(final Map<Long, JsonNode> vehicles) {
        this.vehicles = Map.copyOf(vehicles);
        final Set<String> knownNames = new HashSet<>();
        for (final JsonNode vehicle : this.vehicles.values()) {
            if (vehicle != null && vehicle.hasNonNull("name")) {
                knownNames.add(vehicle.get("name").asText());
            }
        }
        this.names = Set.copyOf(knownNames);
    }

    public static Tankopedia load() {
        return TankopediaReferenceData.tankopedia();
    }

    static Tankopedia loadFromResources() {
        final Map<Long, JsonNode> map = new HashMap<>();
        for (final String resource : TIER_RESOURCES) {
            try (InputStream in = Tankopedia.class.getResourceAsStream(resource)) {
                if (in != null) {
                    final JsonNode root = JsonMapper.builder().build().readTree(in);
                    final JsonNode list = root.get("vehicles");
                    if (list != null && list.isArray()) {
                        for (final JsonNode vehicle : list) {
                            if (vehicle != null && vehicle.hasNonNull("id") && vehicle.get("id").canConvertToLong()) {
                                map.put(vehicle.get("id").longValue(), vehicle);
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        }
        return new Tankopedia(map);
    }

    public TankInfo info(final long tankId) {
        final JsonNode vehicle = vehicles.get(tankId);
        if (vehicle == null) {
            return new TankInfo("#" + tankId, "", "", "", null, null, "");
        }
        final String name = vehicle.hasNonNull("name") ? vehicle.get("name").asText() : "#" + tankId;
        final Object tier = vehicle.hasNonNull("tier") ? vehicle.get("tier").asInt() : "";
        final String type = vehicle.hasNonNull("class") ? vehicle.get("class").asText() : "";
        final String nation = vehicle.hasNonNull("nation") ? vehicle.get("nation").asText() : "";
        final Integer alphaDamage = firstInt(vehicle, "alphaDamage");
        final Integer maxHp = firstInt(vehicle, "hp");
        final String extraInfo = vehicle.hasNonNull("extraInfo")
                ? vehicle.get("extraInfo").asText() : "";
        return new TankInfo(name, tier, type, nation, alphaDamage, maxHp, extraInfo);
    }

    private static Integer firstInt(final JsonNode node, final String key) {
        if (node != null && node.hasNonNull(key) && node.get(key).canConvertToInt()) {
            return node.get(key).asInt();
        }
        return null;
    }

    public int size() {
        return vehicles.size();
    }

    public Set<String> names() {
        return names;
    }
}
