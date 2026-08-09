package com.wotb.core.replay.map;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 地图战术语义库：按内部地图 code（meta.json 的 mapName，全小写）查询 {@link MapTacticalSemantics}。
 * <p>数据源 {@code common/map-semantics/*.semantic.json}（{@code map-semanticizer} 从
 * Wot Blitz 客户端 SC2 + heightmap 解码生成，构建时复制到 classpath:/map-semantics/）。
 * 每份文档按以下键注册：
 * <ul>
 *   <li>文档 {@code mapId}（如 {@code 02_desert_train_dt}）；</li>
 *   <li>文档 {@code mapCodes}（脚本 {@code --map-code} 写入的内部 code，如 {@code desert_train}）；</li>
 *   <li>{@code mapId} 的下划线分词连续子序列（如 {@code desert_train}），覆盖未显式提供
 *   {@code mapCodes} 的旧文件，匹配必须位于 token 边界，避免把 {@code train} 这类短词误匹配。</li>
 * </ul>
 * 未收录的地图返回 {@link MapTacticalSemantics#UNKNOWN}，禁止 LLM 编造区域语义。</p>
 */
public final class MapTacticalSemanticsRegistry {

    private final Map<String, MapTacticalSemantics> byMapId;

    private MapTacticalSemanticsRegistry(final Map<String, MapTacticalSemantics> byMapId) {
        this.byMapId = byMapId;
    }

    public static MapTacticalSemanticsRegistry load() {
        final Map<String, MapTacticalSemantics> map = new LinkedHashMap<>();
        try {
            final Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath:/map-semantics/*.semantic.json");
            Arrays.sort(resources,
                    Comparator.comparing(r -> r.getFilename() == null ? "" : r.getFilename()));
            for (final Resource resource : resources) {
                try (InputStream in = resource.getInputStream()) {
                    parseDocument(JsonMapper.builder().build().readTree(in), map);
                } catch (final Exception ignored) {
                    // 单张地图损坏不影响其余语义库
                }
            }
        } catch (final IOException ignored) {
            // 语义库缺失时全部 UNKNOWN（与 Tankopedia 缺库策略一致）
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

    private static void parseDocument(final JsonNode root,
                                      final Map<String, MapTacticalSemantics> map) {
        if (root == null || !root.hasNonNull("mapId")
                || !root.hasNonNull("areas") || !root.get("areas").isObject()) {
            return;
        }
        final String mapId = normalize(root.get("mapId").asText());
        final MapTacticalSemantics semantics = parse(mapId, root);
        if (!semantics.hasSemantics()) {
            return;
        }
        register(map, semantics, mapId);
        final JsonNode mapCodes = root.get("mapCodes");
        if (mapCodes != null && mapCodes.isArray()) {
            mapCodes.forEach(code -> register(map, semantics, normalize(code.asText())));
        }
        for (final String alias : boundedTokenAliases(mapId)) {
            register(map, semantics, alias);
        }
    }

    private static MapTacticalSemantics parse(final String mapId, final JsonNode root) {
        final Map<String, MapTacticalSemantics.TacticalArea> areas = new LinkedHashMap<>();
        final JsonNode areasNode = root.get("areas");
        if (areasNode != null && areasNode.isObject()) {
            areasNode.properties().forEach(entry -> areas.put(
                    entry.getKey(),
                    parseArea(entry.getKey(), entry.getValue())));
        }
        final Map<String, MapTacticalSemantics.AreaRelationships> relationships =
                parseRelationships(root.get("relationships"));
        final Map<String, MapTacticalSemantics.SpawnSemantics> spawnSemantics =
                parseSpawnSemantics(root.get("spawnSemantics"));
        return new MapTacticalSemantics(mapId, areas, relationships, spawnSemantics);
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

    /** 语义化器把关系输出为扁平数组（{from, type, to, reason, confidence}），按 from 分组。 */
    private static Map<String, MapTacticalSemantics.AreaRelationships> parseRelationships(
            final JsonNode node) {
        final Map<String, List<String>> controls = new LinkedHashMap<>();
        final Map<String, List<String>> connects = new LinkedHashMap<>();
        final Map<String, List<String>> pressure = new LinkedHashMap<>();
        final Map<String, List<String>> higherThan = new LinkedHashMap<>();
        final Map<String, List<String>> containsPoints = new LinkedHashMap<>();
        if (node != null && node.isArray()) {
            node.forEach(relation -> {
                if (relation == null || !relation.isObject()) {
                    return;
                }
                final String from = relation.path("from").asText().trim();
                final String type = relation.path("type").asText();
                final String to = relation.path("to").asText();
                if (from.isEmpty() || to.isBlank()) {
                    return;
                }
                switch (type) {
                    case "CONTROLS" -> controls.computeIfAbsent(from, k -> new ArrayList<>()).add(to);
                    case "ADJACENT_TO" -> connects.computeIfAbsent(from, k -> new ArrayList<>()).add(to);
                    case "ENABLES_PRESSURE_AGAINST" ->
                            pressure.computeIfAbsent(from, k -> new ArrayList<>()).add(to);
                    case "HIGHER_THAN" -> higherThan.computeIfAbsent(from, k -> new ArrayList<>()).add(to);
                    case "CONTAINS_CONTROL_POINT", "CONTAINS_STRATEGIC_POINT" ->
                            containsPoints.computeIfAbsent(from, k -> new ArrayList<>()).add(to);
                    default -> {
                        // 未知关系类型不猜测
                    }
                }
            });
        }
        final Map<String, MapTacticalSemantics.AreaRelationships> result = new LinkedHashMap<>();
        final Set<String> keys = new LinkedHashSet<>();
        keys.addAll(controls.keySet());
        keys.addAll(connects.keySet());
        keys.addAll(pressure.keySet());
        keys.addAll(higherThan.keySet());
        keys.addAll(containsPoints.keySet());
        keys.forEach(key -> result.put(key, new MapTacticalSemantics.AreaRelationships(
                controls.getOrDefault(key, List.of()),
                connects.getOrDefault(key, List.of()),
                pressure.getOrDefault(key, List.of()),
                higherThan.getOrDefault(key, List.of()),
                containsPoints.getOrDefault(key, List.of()))));
        return result;
    }

    private static Map<String, MapTacticalSemantics.SpawnSemantics> parseSpawnSemantics(
            final JsonNode node) {
        final Map<String, MapTacticalSemantics.SpawnSemantics> result = new LinkedHashMap<>();
        if (node != null && node.isObject()) {
            node.properties().forEach(entry -> result.put(
                    entry.getKey(),
                    new MapTacticalSemantics.SpawnSemantics(
                            text(entry.getValue(), "status"),
                            entry.getValue().path("spawnCount").asInt(0),
                            stringList(entry.getValue(), "areas"))));
        }
        return result;
    }

    /**
     * 从 {@code mapId} 生成 token 边界别名：下划线分词后的连续子序列（长度 ≥ 2），
     * 例如 {@code 02_desert_train_dt} → {@code desert_train}。避免单个 token（如
     * {@code train}）被当成内部地图 code。
     */
    static List<String> boundedTokenAliases(final String mapId) {
        final List<String> tokens = new ArrayList<>(List.of(mapId.split("_")));
        tokens.removeIf(String::isBlank);
        final Set<String> aliases = new LinkedHashSet<>();
        for (int length = 2; length <= tokens.size(); length++) {
            for (int start = 0; start + length <= tokens.size(); start++) {
                aliases.add(String.join("_", tokens.subList(start, start + length)));
            }
        }
        return new ArrayList<>(aliases);
    }

    private static void register(final Map<String, MapTacticalSemantics> map,
                                 final MapTacticalSemantics semantics,
                                 final String key) {
        if (!key.isEmpty()) {
            map.putIfAbsent(key, semantics);
        }
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
