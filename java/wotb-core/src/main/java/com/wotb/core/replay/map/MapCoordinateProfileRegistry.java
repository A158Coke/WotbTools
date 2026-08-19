package com.wotb.core.replay.map;

import com.wotb.core.replay.feature.MapCoordinateProfile;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 每张地图的坐标 profile 注册表：从 {@code common/map-semantics/*.semantic.json} 的
 * {@code playableBoundsMeters} 推导（外接可玩区的半边长 + 可玩区中心偏移），
 * 与语义化器的九宫格切分保持一致（areas.gridRegions 正是按 playableBounds 三等分计算）。
 *
 * <p>单一数据源：不维护第二份坐标配置，语义文件更新（或新增地图）后 profile 自动跟随；
 * 未收录/无有效边界的地图回退 {@link MapCoordinateProfile#DEFAULT}（中心原点、半场 250）。</p>
 */
public final class MapCoordinateProfileRegistry {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();
    private static volatile Map<String, MapCoordinateProfile> cache;

    private MapCoordinateProfileRegistry() {
    }

    /** 按地图 code 取 profile；未收录或无效时回退 DEFAULT。 */
    public static MapCoordinateProfile profileFor(final String mapCode) {
        final Map<String, MapCoordinateProfile> profiles = load();
        final String key = normalize(mapCode);
        return key == null ? MapCoordinateProfile.DEFAULT
                : profiles.getOrDefault(key, MapCoordinateProfile.DEFAULT);
    }

    /** 全量加载（懒加载 + 缓存）。 */
    public static Map<String, MapCoordinateProfile> load() {
        Map<String, MapCoordinateProfile> local = cache;
        if (local != null) {
            return local;
        }
        final Map<String, MapCoordinateProfile> profiles = new HashMap<>();
        try {
            final Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath:/map-semantics/*.semantic.json");
            for (final Resource resource : resources) {
                try {
                    final JsonNode root = MAPPER.readTree(resource.getInputStream());
                    final JsonNode bounds = root.path("playableBoundsMeters");
                    if (!bounds.isObject() || !bounds.hasNonNull("xMin") || !bounds.hasNonNull("xMax")
                            || !bounds.hasNonNull("yMin") || !bounds.hasNonNull("yMax")) {
                        continue;
                    }
                    final MapCoordinateProfile profile = fromBounds(
                            bounds.path("xMin").asDouble(),
                            bounds.path("xMax").asDouble(),
                            bounds.path("yMin").asDouble(),
                            bounds.path("yMax").asDouble());
                    final String mapId = root.path("mapId").asText("");
                    if (!mapId.isBlank()) {
                        register(profiles, profile, mapId);
                    }
                    final JsonNode mapCodes = root.path("mapCodes");
                    if (mapCodes.isArray()) {
                        for (final JsonNode code : mapCodes) {
                            register(profiles, profile, code.asText());
                        }
                    }
                    if (!mapId.isBlank()) {
                        for (final String alias : MapTacticalSemanticsRegistry
                                .boundedTokenAliases(mapId)) {
                            register(profiles, profile, alias);
                        }
                    }
                } catch (final Exception ignored) {
                    // 单份文件损坏不影响其余地图；profileFor 回退 DEFAULT。
                }
            }
        } catch (final Exception ignored) {
            // classpath 不可用时保持空表。
        }
        cache = profiles;
        return profiles;
    }

    /** 从 semantic playableBounds 推导：外接正方形半边长 + 中心偏移，clampTolerance 沿用默认 12.5。 */
    public static MapCoordinateProfile fromBounds(
            final double xMin, final double xMax, final double yMin, final double yMax) {
        final double centerX = (xMin + xMax) / 2.0;
        final double centerZ = (yMin + yMax) / 2.0;
        final double halfX = (xMax - xMin) / 2.0;
        final double halfZ = (yMax - yMin) / 2.0;
        final double halfExtent = Math.max(halfX, halfZ);
        return new MapCoordinateProfile(
                (float) halfExtent,
                MapCoordinateProfile.DEFAULT.clampTolerance(),
                (float) centerX,
                (float) centerZ);
    }

    private static void register(final Map<String, MapCoordinateProfile> map,
                                 final MapCoordinateProfile profile,
                                 final String code) {
        final String key = normalize(code);
        if (key != null) {
            map.putIfAbsent(key, profile);
        }
    }

    private static String normalize(final String code) {
        return code == null ? null : code.trim().toLowerCase(Locale.ROOT);
    }
}
