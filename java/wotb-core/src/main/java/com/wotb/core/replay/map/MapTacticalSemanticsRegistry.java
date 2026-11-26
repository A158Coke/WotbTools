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
                }
            }
        } catch (final IOException ignored) {
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
        final List<MapTacticalSemantics.TacticalRelationship> relationships =
                parseRelationships(root.get("relationships"));
        final Map<String, MapTacticalSemantics.SpawnSemantics> spawnSemantics =
                parseSpawnSemantics(root.get("spawnSemantics"));
        return new MapTacticalSemantics(
                mapId,
                areas,
                relationships,
                spawnSemantics,
                root.path("verified").asBoolean(false),
                text(root, "source"),
                text(root, "displayName"));
    }

    private static MapTacticalSemantics.TacticalArea parseArea(
            final String id, final JsonNode node) {
        return new MapTacticalSemantics.TacticalArea(
                id,
                text(node, "label"),
                stringList(node, "types"),
                nineGridRegions(node.get("gridRegions")),
                stringList(node, "characteristics"),
                stringList(node, "favors"),
                stringList(node, "risks"),
                parseAreaConfidence(node.get("confidence")));
    }

    private static MapTacticalSemantics.AreaConfidence parseAreaConfidence(
            final JsonNode node) {
        return new MapTacticalSemantics.AreaConfidence(
                text(node, "geometry"),
                text(node, "objectPositions"),
                text(node, "objectCategories"),
                text(node, "areaBoundary"),
                text(node, "favorsAndRisks"));
    }

    private static List<String> nineGridRegions(final JsonNode node) {
        final List<String> result = new ArrayList<>();
        if (node != null && node.isArray()) {
            node.forEach(item -> {
                if (item.isIntegralNumber()) {
                    result.add("GRID_REGION_" + item.asInt());
                }
            });
        }
        return result;
    }

    private static List<MapTacticalSemantics.TacticalRelationship> parseRelationships(
            final JsonNode node) {
        final List<MapTacticalSemantics.TacticalRelationship> result = new ArrayList<>();
        if (node != null && node.isArray()) {
            node.forEach(relation -> {
                if (relation == null || !relation.isObject()) {
                    return;
                }
                final String from = relation.path("from").asText().trim();
                if (from.isEmpty()) {
                    return;
                }
                result.add(new MapTacticalSemantics.TacticalRelationship(
                        from,
                        relation.path("type").asText(),
                        relation.path("to").asText(),
                        relation.path("reason").asText(),
                        relation.path("confidence").asText()));
            });
        }
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
