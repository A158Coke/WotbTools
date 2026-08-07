package com.wotb.core.ref;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.core.model.TankInfo;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** 车辆库 (tank_id -> 车辆信息), 来自 blitzkit（按等级拆分的 4 个 tier 文件）。 */
public final class Tankopedia {

    private static final String[] TIER_RESOURCES = {
            "/tankopedia-tier7.json",
            "/tankopedia-tier8.json",
            "/tankopedia-tier9.json",
            "/tankopedia-tier10.json",
    };

    private final Map<Long, JsonNode> vehicles;

    private Tankopedia(final Map<Long, JsonNode> vehicles) {
        this.vehicles = vehicles;
    }

    /** 从 classpath 的 4 个等级文件加载（tankopedia-tier{7,8,9,10}.json）。 */
    public static Tankopedia load() {
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
                // 缺库时降级为只显示车辆ID
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
        final Integer alphaDamage = defaultGunInt(vehicle, "alphaDamage");
        final Integer maxHp = firstInt(vehicle, "hp");
        final String extraInfo = vehicle.hasNonNull("extraInfo")
                ? vehicle.get("extraInfo").asText() : "";
        return new TankInfo(name, tier, type, nation, alphaDamage, maxHp, extraInfo);
    }

    /** 默认炮（isDefault=true，否则第一把）的整数字段。 */
    private static Integer defaultGunInt(final JsonNode vehicle, final String field) {
        final JsonNode guns = vehicle.get("guns");
        if (guns == null || !guns.isArray() || guns.isEmpty()) {
            return null;
        }
        JsonNode gun = null;
        for (final JsonNode g : guns) {
            if (g != null && g.hasNonNull("isDefault") && g.get("isDefault").asBoolean()) {
                gun = g;
                break;
            }
        }
        if (gun == null) {
            gun = guns.get(0);
        }
        if (gun != null && gun.hasNonNull(field) && gun.get(field).canConvertToInt()) {
            return gun.get(field).asInt();
        }
        return null;
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
}
