package com.wotb.core.ref;

import com.wotb.core.model.TankInfo;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 车辆库 (tank_id -> 车辆信息), 来自 blitzkit（按等级拆分的 4 个 tier 文件）。
 */
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

    /**
     * 从 classpath 的 4 个等级文件加载（tankopedia-tier{7,8,9,10}.json）。
     */
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
        // 权威炮伤只在数据层有唯一依据时输出（单炮车 / 7-9 顶配炮）；
        // 10 级多炮车不输出 vehicle 级 alphaDamage，这里返回 null，
        // AI structured facts 会省略炮伤，而不是把不确定值伪装成本场实际炮伤。
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

    /**
     * 全部已知坦克名（tier7-10 词表，与 {@link #info} 同源）。
     * <p>供 AI 复盘正文的车名校验使用：判断正文中出现的车名是否属于已知车辆、
     * 是否属于本场 roster。名称本身仍是权威专有名词，不得由名称推断属性。</p>
     */
    public Set<String> names() {
        final Set<String> names = new HashSet<>();
        for (final JsonNode vehicle : vehicles.values()) {
            if (vehicle != null && vehicle.hasNonNull("name")) {
                names.add(vehicle.get("name").asText());
            }
        }
        return names;
    }
}
