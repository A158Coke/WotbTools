package com.wotb.core.replay.map;

import com.wotb.core.replay.feature.MapCoordinateProfile;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class MapCoordinateProfileRegistry {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();
    private static volatile Map<String, MapCoordinateProfile> cache;

    private MapCoordinateProfileRegistry() {
    }

    public static MapCoordinateProfile profileFor(final String mapCode) {
        final Map<String, MapCoordinateProfile> profiles = load();
        final String key = normalize(mapCode);
        return key == null ? MapCoordinateProfile.DEFAULT
                : profiles.getOrDefault(key, MapCoordinateProfile.DEFAULT);
    }

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
                }
            }
        } catch (final IOException ignored) {
        }
        cache = profiles;
        return profiles;
    }

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
