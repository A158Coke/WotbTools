package com.wotb.core.replay.map;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 地图网格级坐标档案注册表：从 {@code classpath:/map-semantics/*.semantic.json} 读取
 * {@code playableBoundsMeters} / {@code analysisGrid.cells} / {@code sceneEvidence.battlePoints}，
 * 按内部地图 code（小写）提供 {@link MapGridProfile}。
 * <p>与 {@link MapCoordinateProfileRegistry} / {@link MapTacticalSemanticsRegistry} 同源：
 * 语义文件是唯一数据源，未收录/无有效数据的地图返回 {@code null}（调用方降级为不渲染）。</p>
 */
public final class MapGridRegistry {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();
    private static volatile Map<String, MapGridProfile> cache;

    private MapGridRegistry() {
    }

    /** 按地图 code 取档案；未收录/无有效网格时返回 null。 */
    public static MapGridProfile profileFor(final String mapCode) {
        if (mapCode == null || mapCode.isBlank()) {
            return null;
        }
        final MapGridProfile profile = load().get(normalize(mapCode));
        return profile != null && profile.hasGrid() ? profile : null;
    }

    /** 全量加载（懒加载 + 缓存）。 */
    public static Map<String, MapGridProfile> load() {
        Map<String, MapGridProfile> local = cache;
        if (local != null) {
            return local;
        }
        final Map<String, MapGridProfile> profiles = new HashMap<>();
        try {
            final Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath:/map-semantics/*.semantic.json");
            for (final Resource resource : resources) {
                try {
                    final JsonNode root = MAPPER.readTree(resource.getInputStream());
                    final MapGridProfile profile = parse(root);
                    if (profile == null) {
                        continue;
                    }
                    final String mapId = root.path("mapId").asText("");
                    register(profiles, profile, mapId);
                    final JsonNode mapCodes = root.path("mapCodes");
                    if (mapCodes.isArray()) {
                        for (final JsonNode code : mapCodes) {
                            register(profiles, profile, code.asText());
                        }
                    }
                } catch (final Exception ignored) {
                    // 单份文件损坏不影响其余地图；profileFor 返回 null。
                }
            }
        } catch (final Exception ignored) {
            // classpath 不可用时保持空表。
        }
        cache = profiles;
        return profiles;
    }

    private static void register(final Map<String, MapGridProfile> profiles,
                                 final MapGridProfile profile,
                                 final String key) {
        final String normalized = normalize(key);
        if (normalized != null) {
            profiles.putIfAbsent(normalized, profile);
        }
    }

    private static String normalize(final String code) {
        if (code == null) {
            return null;
        }
        final String trimmed = code.trim().toLowerCase(Locale.ROOT);
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static MapGridProfile parse(final JsonNode root) {
        final String mapId = root.path("mapId").asText("");
        if (mapId.isBlank()) {
            return null;
        }
        final JsonNode boundsNode = root.path("playableBoundsMeters");
        if (!boundsNode.isObject() || !boundsNode.hasNonNull("xMin") || !boundsNode.hasNonNull("xMax")
                || !boundsNode.hasNonNull("yMin") || !boundsNode.hasNonNull("yMax")) {
            return null;
        }
        final MapGridProfile.Bounds bounds = new MapGridProfile.Bounds(
                boundsNode.path("xMin").asDouble(),
                boundsNode.path("xMax").asDouble(),
                boundsNode.path("yMin").asDouble(),
                boundsNode.path("yMax").asDouble());

        final List<MapGridProfile.GridCell> cells = new ArrayList<>();
        final JsonNode cellsNode = root.path("analysisGrid").path("cells");
        if (cellsNode.isArray()) {
            for (final JsonNode cell : cellsNode) {
                final JsonNode cellBounds = cell.path("boundsMeters");
                if (!cellBounds.isObject() || !cellBounds.hasNonNull("xMin")
                        || !cellBounds.hasNonNull("xMax") || !cellBounds.hasNonNull("yMin")
                        || !cellBounds.hasNonNull("yMax")) {
                    continue;
                }
                cells.add(new MapGridProfile.GridCell(
                        cell.path("id").asText(""),
                        cell.path("nineGridRegion").asInt(-1),
                        new MapGridProfile.Bounds(
                                cellBounds.path("xMin").asDouble(),
                                cellBounds.path("xMax").asDouble(),
                                cellBounds.path("yMin").asDouble(),
                                cellBounds.path("yMax").asDouble())));
            }
        }
        if (cells.isEmpty()) {
            return null;
        }

        final List<MapGridProfile.SpawnPoint> spawns = new ArrayList<>();
        final JsonNode battlePoints = root.path("sceneEvidence").path("battlePoints");
        if (battlePoints.isArray()) {
            for (final JsonNode point : battlePoints) {
                if (!"spawnpoint".equals(point.path("type").asText(""))) {
                    continue;
                }
                final JsonNode pos = point.path("position");
                if (!pos.isArray() || pos.size() < 2) {
                    continue;
                }
                spawns.add(new MapGridProfile.SpawnPoint(
                        point.path("name").asText(""),
                        point.path("team").asInt(-1),
                        pos.path(0).asDouble(),
                        pos.path(1).asDouble()));
            }
        }

        final String displayName = root.path("displayName").asText(mapId);
        return new MapGridProfile(
                mapId,
                displayName,
                bounds,
                cells,
                spawns);
    }
}
