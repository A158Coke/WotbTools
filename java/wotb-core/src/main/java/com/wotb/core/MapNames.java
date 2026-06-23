package com.wotb.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 地图内部名 -> 中文名 (来自 meta.json 的 mapName 字段)。
 * 单一来源在 common/map_names.json(构建时复制到 classpath:/map_names.json),
 * 前端 App.vue 直接 import 同一份 JSON,避免两边漂移。
 */
public final class MapNames {

    private static final Map<String, String> CN = load();

    private MapNames() {
    }

    private static Map<String, String> load() {
        Map<String, String> map = new HashMap<>();
        try (InputStream in = MapNames.class.getResourceAsStream("/map_names.json")) {
            if (in != null) {
                JsonNode root = new ObjectMapper().readTree(in);
                root.fields().forEachRemaining(e -> map.put(e.getKey(), e.getValue().asText()));
            }
        } catch (Exception ignored) {
            // 缺映射表时降级为显示原始内部名
        }
        return map;
    }

    /** 中文名;未匹配则原样返回(与 Python get_map_cn_name 行为一致)。 */
    public static String cn(final String mapName) {
        if (mapName == null || mapName.isEmpty()) {
            return mapName;
        }
        return CN.getOrDefault(mapName.toLowerCase().trim(), mapName);
    }
}
