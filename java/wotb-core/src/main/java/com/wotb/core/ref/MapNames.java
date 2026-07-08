package com.wotb.core.ref;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 地图内部名 -> 多语显示名 (来自 meta.json 的 mapName 字段)。
 * 单一来源在 common/map_names.json(构建时复制到 classpath:/map_names.json),
 * 前端直接 import 同一份 JSON; 导出层继续固定使用中文，避免两边漂移。
 */
public final class MapNames {

    private static final String LOCALE_ZH = "zh";
    private static final String LOCALE_EN = "en";
    private static final Map<String, String> CN = loadChineseNames();

    private MapNames() {
    }

    private static Map<String, String> loadChineseNames() {
        final Map<String, String> map = new HashMap<>();
        try (InputStream in = MapNames.class.getResourceAsStream("/map_names.json")) {
            if (in != null) {
                final JsonNode root = new ObjectMapper().readTree(in);
                root.fields().forEachRemaining(entry ->
                    map.put(normalizeKey(entry.getKey()), resolveChineseLabel(entry.getKey(), entry.getValue()))
                );
            }
        } catch (Exception ignored) {
            // 缺映射表时降级为显示原始内部名
        }
        return map;
    }

    private static String resolveChineseLabel(final String fallback, final JsonNode node) {
        if (node == null || node.isNull()) {
            return fallback;
        }
        if (node.isTextual()) {
            return node.asText();
        }
        final JsonNode zhNode = node.get(LOCALE_ZH);
        if (zhNode != null && zhNode.isTextual() && !zhNode.asText().isBlank()) {
            return zhNode.asText();
        }
        final JsonNode enNode = node.get(LOCALE_EN);
        if (enNode != null && enNode.isTextual() && !enNode.asText().isBlank()) {
            return enNode.asText();
        }
        return fallback;
    }

    private static String normalizeKey(final String mapName) {
        return mapName == null ? "" : mapName.toLowerCase(Locale.ROOT).trim();
    }

    /** 中文名,未匹配则原样返回(与 Python get_map_cn_name 行为一致)。 */
    public static String cn(final String mapName) {
        if (mapName == null || mapName.isEmpty()) {
            return mapName;
        }
        return CN.getOrDefault(normalizeKey(mapName), mapName);
    }
}
