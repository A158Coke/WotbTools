package com.wotb.core.replay.map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 地图战术语义库：按内部地图 code（全小写）查询 {@link MapTacticalSemantics}。
 * <p>数据源 {@code common/map_tactical_semantics.json}（构建时复制到 classpath）。
 * V1 语义库当前为空：没有经过验证的地图数据，任何地图都返回 {@link MapTacticalSemantics#UNKNOWN}，
 * 禁止 LLM 编造区域语义。待真实数据源（官方地图资料 / 社区验证 / 人工审核）确认后，
 * 按 {@code map_code -> { areas, relationships }} 结构填充。</p>
 */
public final class MapTacticalSemanticsRegistry {

    private final Map<String, MapTacticalSemantics> byMapId;

    private MapTacticalSemanticsRegistry(final Map<String, MapTacticalSemantics> byMapId) {
        this.byMapId = byMapId;
    }

    public static MapTacticalSemanticsRegistry load() {
        final Map<String, MapTacticalSemantics> map = new HashMap<>();
        try (InputStream in = MapTacticalSemanticsRegistry.class
                .getResourceAsStream("/map_tactical_semantics.json")) {
            if (in != null) {
                final JsonNode root = JsonMapper.builder().build().readTree(in);
                root.properties().forEach(e -> map.put(
                        normalize(e.getKey()),
                        parse(e.getKey(), e.getValue())));
            }
        } catch (final Exception ignored) {
            // 缺库时全部 UNKNOWN（与 Tankopedia 缺库策略一致）
        }
        return new MapTacticalSemanticsRegistry(Collections.unmodifiableMap(map));
    }

    /**
     * @return 地图语义；未收录/空输入返回 {@link MapTacticalSemantics#UNKNOWN}。
     */
    public MapTacticalSemantics semanticsFor(final String mapCode) {
        if (mapCode == null || mapCode.isBlank()) {
            return MapTacticalSemantics.UNKNOWN;
        }
        return byMapId.getOrDefault(normalize(mapCode), MapTacticalSemantics.UNKNOWN);
    }

    private static MapTacticalSemantics parse(final String mapId, final JsonNode node) {
        final Map<String, MapTacticalSemantics.TacticalArea> areas = new LinkedHashMap<>();
        final JsonNode areasNode = node.get("areas");
        if (areasNode != null && areasNode.isObject()) {
            areasNode.properties().forEach(entry -> areas.put(
                    entry.getKey(),
                    parseArea(entry.getKey(), entry.getValue())));
        }
        final Map<String, MapTacticalSemantics.AreaRelationships> relationships = new LinkedHashMap<>();
        final JsonNode relsNode = node.get("relationships");
        if (relsNode != null && relsNode.isObject()) {
            relsNode.properties().forEach(entry -> relationships.put(
                    entry.getKey(),
                    parseRelationships(entry.getValue())));
        }
        return new MapTacticalSemantics(mapId, areas, relationships);
    }

    private static MapTacticalSemantics.TacticalArea parseArea(
            final String id, final JsonNode node) {
        return new MapTacticalSemantics.TacticalArea(
                id,
                text(node, "label"),
                stringList(node, "types"),
                stringList(node, "characteristics"),
                stringList(node, "favors"),
                stringList(node, "risks"));
    }

    private static MapTacticalSemantics.AreaRelationships parseRelationships(final JsonNode node) {
        return new MapTacticalSemantics.AreaRelationships(
                stringList(node, "controls"),
                stringList(node, "connects"),
                stringList(node, "enablesPressureAgainst"));
    }

    private static String text(final JsonNode node, final String key) {
        return node != null && node.hasNonNull(key) ? node.get(key).asText() : "";
    }

    private static List<String> stringList(final JsonNode node, final String key) {
        final List<String> result = new ArrayList<>();
        if (node != null && node.hasNonNull(key) && node.get(key).isArray()) {
            node.get(key).forEach(item -> result.add(item.asText()));
        }
        return result;
    }

    private static String normalize(final String mapCode) {
        return mapCode == null ? "" : mapCode.trim().toLowerCase(Locale.ROOT);
    }
}
