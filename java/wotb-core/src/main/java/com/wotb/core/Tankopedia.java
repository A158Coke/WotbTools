package com.wotb.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.core.model.TankInfo;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** 车辆库 (tank_id -> 名称/等级/车种/国家), 来自 blitzkit。 */
public final class Tankopedia {

    private final Map<String, JsonNode> data;

    private Tankopedia(final Map<String, JsonNode> data) {
        this.data = data;
    }

    /** 从 classpath 的 tankopedia.json 加载。 */
    public static Tankopedia load() {
        Map<String, JsonNode> map = new HashMap<>();
        try (InputStream in = Tankopedia.class.getResourceAsStream("/tankopedia.json")) {
            if (in != null) {
                JsonNode root = new ObjectMapper().readTree(in);
                JsonNode d = root.has("data") ? root.get("data") : root;
                d.fields().forEachRemaining(e -> map.put(e.getKey(), e.getValue()));
            }
        } catch (Exception ignored) {
            // 缺库时降级为只显示车辆ID
        }
        return new Tankopedia(map);
    }

    public TankInfo info(final long tankId) {
        JsonNode t = data.get(String.valueOf(tankId));
        if (t == null) {
            return new TankInfo("#" + tankId, "", "", "");
        }
        String name = t.hasNonNull("name") ? t.get("name").asText() : "#" + tankId;
        Object tier = t.hasNonNull("tier") ? t.get("tier").asInt() : "";
        String type = t.hasNonNull("class") ? t.get("class").asText() : "";
        String nation = t.hasNonNull("nation") ? t.get("nation").asText() : "";
        return new TankInfo(name, tier, type, nation);
    }

    public int size() {
        return data.size();
    }
}
