package com.wotb.core.replay.map;

import com.wotb.core.replay.feature.MapCoordinateProfile;
import com.wotb.core.replay.feature.MapRegionResolver;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.Iterator;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Per-map coordinate profile 与 semantic.json 一致性的回归测试：
 * 每张语义地图都有基于 playableBounds 的 profile，且 profile 覆盖整个可玩区；
 * areas.gridRegions 与 per-map 九宫格解析自洽（防止统一 ±250 假设导致区域错位）。
 */
class MapCoordinateProfileRegistryTest {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    @Test
    void everySemanticMapHasProfileThatCoversPlayableBounds() throws Exception {
        final Map<String, MapCoordinateProfile> profiles = MapCoordinateProfileRegistry.load();
        final Resource[] resources = new PathMatchingResourcePatternResolver()
                .getResources("classpath:/map-semantics/*.semantic.json");
        int withBounds = 0;
        for (final Resource r : resources) {
            final JsonNode root = MAPPER.readTree(r.getInputStream());
            final JsonNode bounds = root.path("playableBoundsMeters");
            if (!bounds.isObject() || !bounds.hasNonNull("xMin") || !bounds.hasNonNull("xMax")
                    || !bounds.hasNonNull("yMin") || !bounds.hasNonNull("yMax")) {
                continue;
            }
            withBounds++;
            final String mapId = root.path("mapId").asText("");
            assertTrue(profiles.containsKey(mapId), "profile missing for " + mapId);
            final MapCoordinateProfile profile = profiles.get(mapId);
            assertNotEquals(MapCoordinateProfile.DEFAULT, profile,
                    "profile must be derived from playableBounds: " + mapId);
            final float xMin = (float) bounds.path("xMin").asDouble();
            final float xMax = (float) bounds.path("xMax").asDouble();
            final float yMin = (float) bounds.path("yMin").asDouble();
            final float yMax = (float) bounds.path("yMax").asDouble();
            for (final float[] corner : new float[][]{
                    {xMin, yMin}, {xMin, yMax}, {xMax, yMin}, {xMax, yMax}}) {
                assertTrue(MapRegionResolver.resolve(corner[0], corner[1], profile).usable(),
                        "playable corner out of canonical range: " + mapId
                                + " (" + corner[0] + "," + corner[1] + ")");
            }
        }
        assertEquals(33, withBounds, "all semantic maps must carry playableBoundsMeters");
    }

    @Test
    void unknownOrBlankMapFallsBackToDefault() {
        assertEquals(MapCoordinateProfile.DEFAULT,
                MapCoordinateProfileRegistry.profileFor("no_such_map"));
        assertEquals(MapCoordinateProfile.DEFAULT,
                MapCoordinateProfileRegistry.profileFor(null));
        assertEquals(MapCoordinateProfile.DEFAULT,
                MapCoordinateProfileRegistry.profileFor(" "));
    }

    @Test
    void asymmetricMapGetsCenteredProfile() {
        // himmelsdorf playableBounds x[-259.1,182.9] y[-260.8,255.1]
        final MapCoordinateProfile p = MapCoordinateProfileRegistry.fromBounds(
                -259.1, 182.9, -260.8, 255.1);
        assertEquals(-38.1f, p.centerX(), 0.01f);
        assertEquals(-2.85f, p.centerZ(), 0.01f);
        assertEquals(257.95f, p.halfExtent(), 0.01f);
        // 可玩区边缘应解析为 canonical 边界附近，而不是被裁掉
        final var left = MapRegionResolver.resolve(-259.1f, 0f, p);
        final var right = MapRegionResolver.resolve(182.9f, 0f, p);
        assertTrue(left.usable());
        assertTrue(right.usable());
        assertTrue(left.position().x() < right.position().x());
    }

    @Test
    void analysisGridCellRegionsAreConsistentWithPerMapProfile() throws Exception {
        final Resource[] resources = new PathMatchingResourcePatternResolver()
                .getResources("classpath:/map-semantics/*.semantic.json");
        int cellsChecked = 0;
        for (final Resource r : resources) {
            final JsonNode root = MAPPER.readTree(r.getInputStream());
            final JsonNode bounds = root.path("playableBoundsMeters");
            final JsonNode grid = root.path("analysisGrid").path("cells");
            if (!grid.isArray() || grid.isEmpty() || !bounds.isObject()) {
                continue;
            }
            final String mapId = root.path("mapId").asText("");
            final MapCoordinateProfile profile = MapCoordinateProfileRegistry.profileFor(mapId);
            for (final JsonNode cell : grid) {
                final JsonNode cellBounds = cell.path("boundsMeters");
                final int expectedRegion = cell.path("nineGridRegion").asInt();
                if (!cellBounds.isObject() || !cellBounds.hasNonNull("xMin") || expectedRegion <= 0) {
                    continue;
                }
                final float cx = (float) ((cellBounds.path("xMin").asDouble()
                        + cellBounds.path("xMax").asDouble()) / 2.0);
                final float cz = (float) ((cellBounds.path("yMin").asDouble()
                        + cellBounds.path("yMax").asDouble()) / 2.0);
                final int region = MapRegionResolver.resolveRegionFromRaw(cx, cz, profile);
                assertEquals(expectedRegion, region,
                        "analysisGrid cell region mismatch: " + mapId + "/"
                                + cell.path("id").asText());
                cellsChecked++;
            }
        }
        assertTrue(cellsChecked >= 200, "expected many grid cells validated, got " + cellsChecked);
    }

    @Test
    void areaGridRegionsMatchTheirCellsNineGridRegions() throws Exception {
        final Resource[] resources = new PathMatchingResourcePatternResolver()
                .getResources("classpath:/map-semantics/*.semantic.json");
        int areasChecked = 0;
        for (final Resource r : resources) {
            final JsonNode root = MAPPER.readTree(r.getInputStream());
            final JsonNode areas = root.path("areas");
            final JsonNode cells = root.path("analysisGrid").path("cells");
            if (!areas.isObject() || !cells.isArray()) {
                continue;
            }
            final Map<String, Integer> cellRegion = new java.util.HashMap<>();
            for (final JsonNode cell : cells) {
                cellRegion.put(cell.path("id").asText(), cell.path("nineGridRegion").asInt());
            }
            final String mapId = root.path("mapId").asText("");
            final Iterator<Map.Entry<String, JsonNode>> it = areas.properties().iterator();
            while (it.hasNext()) {
                final Map.Entry<String, JsonNode> area = it.next();
                final JsonNode regionList = area.getValue().path("gridRegions");
                final JsonNode gridCells = area.getValue().path("gridCells");
                if (!regionList.isArray() || regionList.isEmpty() || !gridCells.isArray()) {
                    continue;
                }
                for (final JsonNode cellId : gridCells) {
                    final Integer expected = cellRegion.get(cellId.asText());
                    if (expected == null || expected <= 0) {
                        continue;
                    }
                    boolean listed = false;
                    for (final JsonNode reg : regionList) {
                        if (reg.asInt() == expected) {
                            listed = true;
                            break;
                        }
                    }
                    assertTrue(listed,
                            "area gridRegions must contain its cell's region: " + mapId + "/"
                                    + area.getKey() + " cell=" + cellId.asText()
                                    + " nineGridRegion=" + expected
                                    + " gridRegions=" + regionList);
                }
                areasChecked++;
            }
        }
        assertTrue(areasChecked >= 100, "expected many areas validated, got " + areasChecked);
    }
}
