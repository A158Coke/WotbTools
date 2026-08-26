package com.wotb.core;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.EventStreamReader;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 地图坐标校准探针（手动维护，不进常规 CI）：
 * 运行方式 {@code mvn -pl wotb-core test -Dtest=MapCoordinateCalibrationProbeTest -Dprobe.replay=<file>}
 * 或 {@code -Dprobe.replays=<file1>,<file2>,...} 批量跑多个回放。
 *
 * <p>目标：用回放位置流 + semantic.json 的权威出生点/边界，验证每张地图的坐标映射与九宫格切分：
 * <ul>
 *   <li>回放 type 10 的 (x, z) 与 semantic 的 (x, y) 是否为同一平面坐标（开局位置应贴近 spawnpoint）；</li>
 *   <li>回放位置覆盖 min/max 与 semantic playableBoundsMeters 的关系；</li>
 *   <li>基于 playableBounds 的九宫格三等分线（每图可能不同，且不保证对称）。</li>
 * </ul></p>
 */
class MapCoordinateCalibrationProbeTest {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    @Test
    void probe() throws Exception {
        final String single = System.getProperty("probe.replay");
        final String multiple = System.getProperty("probe.replays");
        Assumptions.assumeTrue(single != null || multiple != null,
                "set -Dprobe.replay=<path> or -Dprobe.replays=<p1>,<p2> to run");
        final List<Path> files = new ArrayList<>();
        if (multiple != null) {
            for (final String part : multiple.split(",")) {
                if (!part.isBlank()) files.add(Path.of(part.trim()));
            }
        } else {
            files.add(Path.of(single));
        }
        for (final Path f : files) {
            probeOne(f);
        }
    }

    private void probeOne(final Path f) throws Exception {
        final byte[] bytes = Files.readAllBytes(f);
        final Map<String, byte[]> entries = new HashMap<>();
        byte[] eventData = null;
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                entries.put(e.getName(), zis.readAllBytes());
                if ("data.wotreplay".equals(e.getName())) {
                    eventData = entries.get(e.getName());
                }
            }
        }
        System.out.println("===== " + f.getFileName() + " =====");
        if (eventData == null) {
            System.out.println("data.wotreplay missing");
            return;
        }
        final JsonNode meta = MAPPER.readTree(entries.get("meta.json"));
        final String mapName = meta.path("mapName").asText("");
        final String mapId = meta.path("mapId").asText("");
        System.out.println("mapName=" + mapName + " mapId=" + mapId
                + " arena=" + meta.path("arenaUniqueId").asText()
                + " duration=" + meta.path("battleDuration").asText());

        final JsonNode semantic = loadSemanticForMap(mapName);
        if (semantic == null) {
            System.out.println("semantic.json NOT FOUND for mapName=" + mapName);
            return;
        }
        final JsonNode bounds = semantic.path("playableBoundsMeters");
        final List<JsonNode> spawns = new ArrayList<>();
        final List<JsonNode> controls = new ArrayList<>();
        semantic.path("sceneEvidence").path("battlePoints").forEach(p -> {
            final String type = p.path("type").asText("");
            if ("spawnpoint".equals(type)) spawns.add(p);
            if ("controlpoint".equals(type)) controls.add(p);
        });
        System.out.println("semantic: display=" + semantic.path("displayName").asText()
                + " verified=" + semantic.path("verified").asBoolean()
                + " spawnpoints=" + spawns.size() + " controlpoints=" + controls.size());
        System.out.println("playableBoundsMeters: x[" + bounds.path("xMin").asText()
                + "," + bounds.path("xMax").asText() + "] y[" + bounds.path("yMin").asText()
                + "," + bounds.path("yMax").asText() + "] (replay axis: x<->x, z<->y)");
        System.out.println("gridThirdLines (playable-based): x=" + thirds(bounds, "xMin", "xMax")
                + " y=" + thirds(bounds, "yMin", "yMax"));

        final EventStreamReader.EventStream es = EventStreamReader.read(eventData);
        final Map<Integer, Long> e2a = EventStreamReader.extractEntityToAccountMap(es.packets);
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new com.wotb.core.model.Source(f.getFileName().toString(), bytes),
                        ReplayProcessingOptions.full());
        final Map<Long, PlayerResult> byAccount = new HashMap<>();
        if (result.battle() != null && result.battle().players != null) {
            result.battle().players.forEach(p -> byAccount.put(p.accountId, p));
        }

        // 全局原始坐标覆盖（所有实体，忽略异常 y）
        final float[] minX = {Float.MAX_VALUE}, maxX = {-Float.MAX_VALUE};
        final float[] minZ = {Float.MAX_VALUE}, maxZ = {-Float.MAX_VALUE};
        int usable = 0;
        for (final EventStreamReader.PositionData p : positions) {
            if (!Float.isFinite(p.x) || !Float.isFinite(p.z) || Math.abs(p.x) > 5000 || Math.abs(p.z) > 5000) {
                continue;
            }
            usable++;
            minX[0] = Math.min(minX[0], p.x);
            maxX[0] = Math.max(maxX[0], p.x);
            minZ[0] = Math.min(minZ[0], p.z);
            maxZ[0] = Math.max(maxZ[0], p.z);
        }
        System.out.println("-- replay raw coverage (type 10, n=" + usable + ") --");
        System.out.println("  axisX: " + fmt(minX[0]) + " .. " + fmt(maxX[0])
                + " span=" + fmt(maxX[0] - minX[0]));
        System.out.println("  axisZ: " + fmt(minZ[0]) + " .. " + fmt(maxZ[0])
                + " span=" + fmt(maxZ[0] - minZ[0]));

        // 每实体：首次位置 -> 最近 spawnpoint
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            if (!Float.isFinite(p.x) || !Float.isFinite(p.z) || Math.abs(p.x) > 5000 || Math.abs(p.z) > 5000) {
                continue;
            }
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        System.out.println("-- per-entity first position vs nearest spawnpoint --");
        int matched10 = 0;
        int matched25 = 0;
        int rosterEntities = 0;
        for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> entry : byEntity.entrySet()) {
            final int eid = entry.getKey();
            final Long acc = e2a.get(eid);
            final PlayerResult pr = acc == null ? null : byAccount.get(acc);
            rosterEntities++;
            final EventStreamReader.PositionData first = entry.getValue().stream()
                    .min(Comparator.comparingDouble(p -> p.clockSecs))
                    .orElseThrow();
            final List<String[]> best = new ArrayList<>(); // [name, team, dist]
            for (final JsonNode s : spawns) {
                final JsonNode pos = s.path("position");
                final float sx = (float) pos.path(0).asDouble();
                final float sy = (float) pos.path(1).asDouble();
                final float d = (float) Math.hypot(first.x - sx, first.z - sy);
                best.add(new String[]{s.path("name").asText(), s.path("team").asText(),
                        String.format(java.util.Locale.ROOT, "%.1f", d)});
            }
            best.sort(Comparator.comparingDouble(c -> Double.parseDouble(c[2])));
            final float bestDist = Float.parseFloat(best.get(0)[2]);
            if (bestDist <= 10f) matched10++;
            if (bestDist <= 25f) matched25++;
            final int firstRegion = MapRegionResolver.resolveRegionFromRaw(first.x, first.z, mapName);
            final JsonNode spawnPos = nearestSpawnPosition(spawns, first);
            final int spawnRegion = spawnPos == null ? -1
                    : MapRegionResolver.resolveRegionFromRaw(
                            (float) spawnPos.path(0).asDouble(),
                            (float) spawnPos.path(1).asDouble(), mapName);
            System.out.println(String.format(
                    "  eid=%d acc=%d team=%d tank=%d first@%.1fs (%.1f, %.1f) y=%.1f region=%d nearest=%s(team=%s,%.1fm,r=%d) alt=%s(%.1fm) %s(%.1fm)",
                    eid, acc == null ? -1 : acc, pr == null ? -1 : pr.team,
                    pr == null ? -1 : pr.tankId,
                    first.clockSecs, first.x, first.z, first.y,
                    firstRegion, best.get(0)[0], best.get(0)[1], bestDist, spawnRegion,
                    best.get(1)[0], Float.parseFloat(best.get(1)[2]),
                    best.get(2)[0], Float.parseFloat(best.get(2)[2])));
        }
        // 开局聚合（不依赖 entity->account）：开局 5s 内所有位置 vs spawnpoint
        final List<EventStreamReader.PositionData> early = positions.stream()
                .filter(p -> p.clockSecs <= 5f
                        && Float.isFinite(p.x) && Float.isFinite(p.z)
                        && Math.abs(p.x) <= 5000 && Math.abs(p.z) <= 5000)
                .toList();
        int early10 = 0;
        int early25 = 0;
        for (final EventStreamReader.PositionData p : early) {
            float bestD = Float.MAX_VALUE;
            for (final JsonNode s : spawns) {
                final JsonNode pos = s.path("position");
                final float d = (float) Math.hypot(
                        p.x - (float) pos.path(0).asDouble(),
                        p.z - (float) pos.path(1).asDouble());
                bestD = Math.min(bestD, d);
            }
            if (bestD <= 10f) early10++;
            if (bestD <= 25f) early25++;
        }
        System.out.println("-- early(<5s) aggregate vs spawnpoints --");
        System.out.println("  earlyPositions=" + early.size()
                + " nearestSpawn<=10m=" + early10 + " <=25m=" + early25
                + " ratio25=" + (early.isEmpty() ? "n/a"
                : String.format(java.util.Locale.ROOT, "%.0f%%", 100.0 * early25 / early.size())));
        System.out.println("-- summary --");
        System.out.println("  rosterEntities=" + rosterEntities
                + " matched<=10m=" + matched10 + " matched<=25m=" + matched25);
        if (!controls.isEmpty()) {
            System.out.print("  controlpoints:");
            for (final JsonNode c : controls) {
                final JsonNode pos = c.path("position");
                System.out.print(" " + c.path("name").asText() + "=(" + fmt((float) pos.path(0).asDouble())
                        + "," + fmt((float) pos.path(1).asDouble()) + ")");
            }
            System.out.println();
        }
    }

    /** semantic 坐标 y 轴（map vertical）对应回放 z 轴；基于 playableBounds 输出三等分线。 */
    private static String thirds(final JsonNode bounds, final String minField, final String maxField) {
        final double min = bounds.path(minField).asDouble();
        final double max = bounds.path(maxField).asDouble();
        final double w = (max - min) / 3.0;
        return String.format(java.util.Locale.ROOT, "[%.1f, %.1f, %.1f]", min + w, min + 2 * w, max);
    }

    private static String fmt(final float v) {
        return String.format(java.util.Locale.ROOT, "%.1f", v);
    }

    private static JsonNode nearestSpawnPosition(
            final List<JsonNode> spawns,
            final EventStreamReader.PositionData pos) {
        JsonNode best = null;
        float bestD = Float.MAX_VALUE;
        for (final JsonNode s : spawns) {
            final JsonNode p = s.path("position");
            final float d = (float) Math.hypot(
                    pos.x - (float) p.path(0).asDouble(),
                    pos.z - (float) p.path(1).asDouble());
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
        return best;
    }

    private static JsonNode loadSemanticForMap(final String mapName) throws Exception {
        final Resource[] resources = new PathMatchingResourcePatternResolver()
                .getResources("classpath:/map-semantics/*.semantic.json");
        for (final Resource r : resources) {
            final JsonNode root = MAPPER.readTree(r.getInputStream());
            final JsonNode codes = root.path("mapCodes");
            if (codes.isArray()) {
                for (final JsonNode c : codes) {
                    if (mapName.equalsIgnoreCase(c.asText())) {
                        return root;
                    }
                }
            }
            // mapId 下划线分词 token 边界匹配（如 grossberg_sh -> grossberg）
            final String mapId = root.path("mapId").asText("");
            if (!mapId.isBlank() && List.of(mapId.toLowerCase(java.util.Locale.ROOT).split("_"))
                    .contains(mapName.toLowerCase(java.util.Locale.ROOT))) {
                return root;
            }
        }
        return null;
    }
}
