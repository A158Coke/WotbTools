package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 地图鸟瞰聚合器契约：真实夹具（rift/Hellas）完整输出 + 降级 null + 网格分桶/阵营。
 */
class MapOverviewBuilderTest {

    private static Path fixture() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replays", "random-battle-example.wotbreplay").normalize();
    }

    private static ReplayProcessingResult processFixture() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        return new DefaultReplayProcessingFacade()
                .process(new Source(fixture().getFileName().toString(), bytes),
                        ReplayProcessingOptions.full());
    }

    @Test
    void fixtureProducesCompleteMapOverview() throws Exception {
        final ReplayProcessingResult result = processFixture();
        assertNotNull(result.battle(), "fixture 应能解析出 Battle");
        assertNotNull(result.reconstruction(), "fixture 应能完成事件流重建");

        final MapOverview overview = MapOverviewBuilder.build(
                result.battle(), result.reconstruction());
        assertNotNull(overview, "rift 有语义网格与观测，mapOverview 不应为 null");

        assertEquals("rift", overview.mapCode());
        assertEquals("Hellas", overview.displayName());
        assertEquals("海拉斯", overview.displayNames().get("zh"));
        assertEquals("Hellas", overview.displayNames().get("en"));
        assertEquals("Эллада", overview.displayNames().get("ru"));
        assertTrue(overview.friendlyTeam() == 1 || overview.friendlyTeam() == 2);
        assertEquals(1, overview.arenaBonusType(), "rift 随机战 fixture arenaBonusType=1");
        assertNotNull(overview.recorderAccountId(), "录像者账号应解析");
        assertTrue(overview.routes().stream().anyMatch(r ->
                        r.accountId() == overview.recorderAccountId()
                                && r.playerName().equals(result.battle().recorder)),
                "recorderAccountId 对应名册中的录像者路线");
        assertTrue(overview.playableBounds().xMin() < overview.playableBounds().xMax());
        assertTrue(overview.playableBounds().yMin() < overview.playableBounds().yMax());
        assertEquals(36, overview.gridCells().size(), "6x6 分析格");
        assertEquals(36, overview.heatmaps().friendly().dwell().size());
        assertEquals(36, overview.heatmaps().friendly().damage().size());
        assertEquals(36, overview.heatmaps().friendly().deaths().size());
        assertEquals(36, overview.heatmaps().enemy().dwell().size());
        assertNull(overview.image(), "image 恒 null——素材由前端 mapImages.js 唯一维护");
        assertFalse(overview.phases().isEmpty(), "应产出阶段切片");
        assertEquals("opening", overview.phases().get(0).key());

        // 战局回放契约：时长/车辆/事件（真实夹具应有 DAMAGE 与可见性事件）
        assertNotNull(overview.playback(), "rift 有观测与名册，playback 不应为 null");
        assertTrue(overview.playback().durationSec() > 0);
        assertFalse(overview.playback().vehicles().isEmpty());
        // 坦克名权威解析（#6/#1）：playback.vehicles[].tankName 由 tankId → tankopedia 映射，
        // 不再是空串（空串会让前端回退显示纯数字 tankId）。
        for (final MapOverview.PlaybackVehicle v : overview.playback().vehicles()) {
            assertFalse(v.tankName().isBlank(), "坦克名应权威解析，非空: " + v.playerName());
            assertFalse(v.tankName().matches("\\d+"), "坦克名不应是纯数字 tankId: " + v.playerName());
        }
        // 回放实测血量（#2）：maxHp 非空且 ≥ tankopedia base；fixture 至少录像者有血量采样
        assertTrue(overview.playback().vehicles().stream()
                        .anyMatch(v -> !v.hpSamples().isEmpty()),
                "fixture 应至少有一辆车（录像者）有回放实测血量采样");
        for (final MapOverview.PlaybackVehicle v : overview.playback().vehicles()) {
            assertNotNull(v.maxHp(), "maxHp 应由回放实测/兜底解析，非空: " + v.playerName());
            final Integer base = ReplayDisplayNames.tankMaxHpValue(v.tankId());
            if (base != null) {
                assertTrue(v.maxHp() >= base, "maxHp 不得低于 tankopedia base: " + v.playerName());
            }
        }
        assertFalse(overview.playback().events().isEmpty());
        assertTrue(overview.playback().events().stream()
                        .anyMatch(e -> "DAMAGE".equals(e.type())),
                "真实夹具应包含 DAMAGE 事件");
        assertTrue(overview.playback().events().stream()
                        .anyMatch(e -> "POSITION_REPORTED".equals(e.type()) || "POSITION_STALE".equals(e.type())),
                "真实夹具应包含可见性事件");
        for (final MapOverview.PlaybackEvent event : overview.playback().events()) {
            assertTrue(event.timeSec() >= 0);
            assertTrue(event.timeSec() <= overview.playback().durationSec() + 1);
        }

        // 方向采样契约：真实夹具（11.18 编码）应有炮塔相对方向样本
        final List<MapOverview.PlaybackVehicle> withDirections = overview.playback().vehicles().stream()
                .filter(v -> !v.directionSamples().isEmpty())
                .toList();
        assertFalse(withDirections.isEmpty(), "真实夹具至少一辆车有方向采样（type-7 propId=2 已破解）");
        for (final MapOverview.PlaybackVehicle v : overview.playback().vehicles()) {
            double lastT = -1;
            for (final MapOverview.DirectionSample s : v.directionSamples()) {
                assertTrue(Double.isFinite(s.timeSec()) && s.timeSec() >= 0);
                assertTrue(s.timeSec() <= overview.playback().durationSec() + 1e-6,
                        "方向采样不得越界");
                assertTrue(s.timeSec() >= lastT, "方向采样按时间升序");
                lastT = s.timeSec();
                assertTrue(Double.isFinite(s.hullYawDeg()), "hull yaw 必须 finite");
                assertTrue(Double.isFinite(s.turretRelativeYawDeg())
                        && s.turretRelativeYawDeg() >= -180.0
                        && s.turretRelativeYawDeg() < 180.0,
                        "turretRelativeYawDeg ∈ [-180,180)");
                if (v.deathSec() != null) {
                    assertTrue(s.timeSec() <= v.deathSec() + 1e-6, "阵亡后不采样");
                }
            }
        }

        assertEquals(14, overview.routes().size(), "双方 14 车");
        for (final MapOverview.Route route : overview.routes()) {
            assertFalse(route.points().isEmpty(), "每车至少一个路线点");
            assertTrue(route.firstObservedSec() >= 0);
            assertTrue(route.lastObservedSec() >= route.firstObservedSec());
            assertTrue(route.points().size() <= 200, "每车 ≤200 点");
            // 采样间隔不高于 max(2s, duration/200)
            for (int i = 1; i < route.points().size(); i++) {
                assertTrue(route.points().get(i).timeSec() >= route.points().get(i - 1).timeSec());
            }
        }
        // 双方阵营都在
        assertTrue(overview.routes().stream().anyMatch(r -> r.team() == 1));
        assertTrue(overview.routes().stream().anyMatch(r -> r.team() == 2));

        // 热力非空：驻留/伤害计数 > 0，阵亡总数 = 14 - 幸存数（权威口径）
        final double friendlyDwell = overview.heatmaps().friendly().dwell().stream()
                .mapToDouble(Double::doubleValue).sum();
        final double enemyDwell = overview.heatmaps().enemy().dwell().stream()
                .mapToDouble(Double::doubleValue).sum();
        final double friendlyDmg = overview.heatmaps().friendly().damage().stream()
                .mapToDouble(Double::doubleValue).sum();
        final double enemyDmg = overview.heatmaps().enemy().damage().stream()
                .mapToDouble(Double::doubleValue).sum();
        assertTrue(friendlyDwell > 0 && enemyDwell > 0, "双方驻留采样非空");
        assertTrue(friendlyDmg > 0 && enemyDmg > 0, "双方伤害热力非空");
        final long dead = result.battle().players.stream().filter(p -> !p.survived).count();
        final double deaths = overview.heatmaps().friendly().deaths().stream()
                .mapToDouble(Double::doubleValue).sum()
                + overview.heatmaps().enemy().deaths().stream()
                .mapToDouble(Double::doubleValue).sum();
        assertEquals(dead, (long) deaths, "阵亡热力总数 == 权威阵亡人数");

        // 路线点坐标落在 playableBounds 内（允许 1m 容差）；死亡标记与权威阵亡一致
        final double xMin = overview.playableBounds().xMin();
        final double xMax = overview.playableBounds().xMax();
        final double yMin = overview.playableBounds().yMin();
        final double yMax = overview.playableBounds().yMax();
        for (final MapOverview.Route route : overview.routes()) {
            for (final MapOverview.Point point : route.points()) {
                assertTrue(point.x() >= xMin - 1 && point.x() <= xMax + 1
                                && point.y() >= yMin - 1 && point.y() <= yMax + 1,
                        "路线点在可玩区内: " + route.playerName());
            }
            if (route.deathSec() != null) {
                assertTrue(route.deathSec() <= result.battle().durationS + 1,
                        "阵亡时刻不晚于战斗结束: " + route.playerName());
            }
        }
    }

    @Test
    void unknownMapReturnsNull() {
        final Battle battle = new Battle();
        battle.mapName = "no_such_map";
        battle.players = List.of(player(1L, "p1", 1, 100));
        assertNull(MapOverviewBuilder.build(battle, null),
                "未知地图/无重建 → null");
    }

    @Test
    void emptyRosterReturnsNull() {
        final Battle battle = new Battle();
        battle.mapName = "rift";
        battle.players = List.of();
        assertNull(MapOverviewBuilder.build(battle, null));
    }

    /**
     * Wire 契约：SSE done 载荷中的 mapOverview JSON 字段名与前端组件消费一致
     * （camelCase；null 降级时字段输出 JSON null）。
     */
    @Test
    @SuppressWarnings("unchecked")
    void jsonContractMatchesFrontendConsumption() throws Exception {
        final ObjectMapper mapper = JsonMapper.builder().build();
        final MapOverview overview = new MapOverview(
                "desert_train",
                "Desert Sands",
                Map.of("zh", "黄沙荒漠", "en", "Desert Sands", "ru", "Пустынные пески"),
                2,
                new MapOverview.Bounds(-256, 260, -251, 254.3),
                List.of(new MapOverview.GridCell("F1", 6,
                        new MapOverview.Bounds(-256, -170, -251, -166.78))),
                null,
                List.of(new MapOverview.SpawnPoint("S1", 2, -200, 200)),
                List.of(new MapOverview.Phase("opening", 0, 45)),
                new MapOverview.Heatmaps(
                        new MapOverview.Layer(List.of(1.0), List.of(250.0), List.of(0.0)),
                        new MapOverview.Layer(List.of(2.0), List.of(300.0), List.of(1.0))),
                List.of(new MapOverview.Route(
                        1L, "p1", 29985L, 2,
                        List.of(new MapOverview.Point(0, 0, 1.5)),
                        0.8, 146.9, 115.0)),
                1,
                1L,
                null,
                null,
                null);
        final Map<String, Object> payload = mapper.convertValue(overview, Map.class);
        assertEquals("desert_train", payload.get("mapCode"));
        assertEquals("Desert Sands", payload.get("displayName"));
        assertEquals("黄沙荒漠", ((Map<?, ?>) payload.get("displayNames")).get("zh"));
        assertEquals(2, payload.get("friendlyTeam"));
        assertTrue(payload.containsKey("playableBounds"));
        assertTrue(payload.containsKey("gridCells"));
        assertTrue(payload.containsKey("image"));
        assertNull(payload.get("image"), "image 恒 null（前端 mapImages.js 为唯一素材源）");
        assertTrue(payload.containsKey("spawnPoints"));
        assertTrue(payload.containsKey("phases"));
        assertTrue(payload.containsKey("heatmaps"));
        assertTrue(payload.containsKey("routes"));
        assertTrue(payload.containsKey("arenaBonusType"));
        assertTrue(payload.containsKey("recorderAccountId"));
        assertEquals(1, payload.get("arenaBonusType"));
        assertEquals(1L, payload.get("recorderAccountId"));
        assertTrue(payload.containsKey("friendlyPoints"));
        assertTrue(payload.containsKey("enemyPoints"));
        assertTrue(payload.containsKey("playback"));
        assertNull(payload.get("playback"), "降级样例 playback 恒 null");
        @SuppressWarnings("unchecked")
        final Map<String, Object> route = (Map<String, Object>) ((List<?>) payload.get("routes")).get(0);
        assertTrue(route.containsKey("firstObservedSec"));
        assertTrue(route.containsKey("lastObservedSec"));
        assertTrue(route.containsKey("deathSec"));
        @SuppressWarnings("unchecked")
        final Map<String, Object> point = (Map<String, Object>) ((List<?>) route.get("points")).get(0);
        assertTrue(point.containsKey("timeSec"));
        assertTrue(point.containsKey("x"));
        assertTrue(point.containsKey("y"));
        final String json = mapper.writeValueAsString(new com.wotb.web.replay.dto.AnalyzeResponse("a", null, null));
        assertTrue(json.contains("\"mapOverview\":null"), "降级时 mapOverview 输出 JSON null");
    }

    private static PlayerResult player(final long account, final String nick,
                                       final int team, final long tank) {
        final PlayerResult p = new PlayerResult();
        p.accountId = account;
        p.nickname = nick;
        p.team = team;
        p.tankId = tank;
        return p;
    }

    // ===== 时间契约 + 方向跨 gap 边界回归 =====

    private static ReplayReconstruction filteredRecon(
            final ReplayReconstruction recon, final List<ReplayEvent> events) {
        return new ReplayReconstruction(
                recon.metadata(), recon.streamHeader(), recon.replayDurationSec(),
                recon.battleStartRawClockSec(), recon.participants(), events,
                recon.checkpoints(), recon.finalState(), recon.coverage(), recon.diagnostics());
    }

    @Test
    void directionSamplesNeverCrossPositionGap() throws Exception {
        final ReplayProcessingResult result = processFixture();
        final ReplayReconstruction recon = result.reconstruction();
        final float battleStart = recon.battleStartRawClockSec() != null
                ? recon.battleStartRawClockSec() : 0f;
        // 制造位置流中断：删除 (40s, 100s) 窗口内的全部位置（两侧保留；prop2 事件原样保留）
        final double gapStart = 40.0;
        final double gapEnd = 100.0;
        final List<ReplayEvent> filtered = new ArrayList<>();
        for (final ReplayEvent e : recon.events()) {
            if (e instanceof PositionChangedEvent pos) {
                final double t = pos.timestamp().rawClockSec() - battleStart;
                if (t > gapStart && t < gapEnd) {
                    continue;
                }
            }
            filtered.add(e);
        }
        final MapOverview overview = MapOverviewBuilder.build(
                result.battle(), filteredRecon(recon, filtered));
        assertNotNull(overview);
        assertNotNull(overview.playback());
        for (final MapOverview.PlaybackVehicle v : overview.playback().vehicles()) {
            // gap 内不得产生任何方向样本（prop2 在 gap 中继续广播也不得推动炮塔）
            assertTrue(v.directionSamples().stream()
                            .noneMatch(s -> s.timeSec() > gapStart + 1e-6
                                    && s.timeSec() < gapEnd - 1e-6),
                    "gap 内的 prop2 不得产生 direction sample: " + v.accountId());
            // 时间升序
            double last = -1;
            for (final MapOverview.DirectionSample s : v.directionSamples()) {
                assertTrue(s.timeSec() >= last);
                last = s.timeSec();
            }
        }
        // gap 前应有冻结点、re-entry 后方向段应继续（至少一辆有方向的车辆同时满足）
        final List<MapOverview.PlaybackVehicle> withDirections = overview.playback().vehicles()
                .stream().filter(v -> !v.directionSamples().isEmpty()).toList();
        assertFalse(withDirections.isEmpty());
        assertTrue(withDirections.stream().anyMatch(v -> v.directionSamples().stream()
                        .anyMatch(s -> s.timeSec() <= gapStart + 1e-6)),
                "gap 前应有方向样本（冻结点）");
        assertTrue(withDirections.stream().anyMatch(v -> v.directionSamples().stream()
                        .anyMatch(s -> s.timeSec() >= gapEnd - 1e-6)),
                "re-entry 后方向段应继续");
    }

    @Test
    void playbackTimesNeverExceedDuration() throws Exception {
        final ReplayProcessingResult result = processFixture();
        result.battle().durationS = 120.0; // 人为把权威时长压到尾部事件之前
        final MapOverview overview = MapOverviewBuilder.build(
                result.battle(), result.reconstruction());
        assertNotNull(overview);
        assertNotNull(overview.playback());
        assertEquals(120.0, overview.playback().durationSec());
        for (final MapOverview.PlaybackEvent e : overview.playback().events()) {
            assertTrue(e.timeSec() >= 0 && e.timeSec() <= 120.0 + 1e-6,
                    "event 越界: " + e);
        }
        for (final MapOverview.PlaybackVehicle v : overview.playback().vehicles()) {
            for (final MapOverview.PositionInterval iv : v.positionIntervals()) {
                assertTrue(iv.startSec() >= 0 && iv.endSec() <= 120.0 + 1e-6,
                        "interval 越界: " + iv);
            }
            for (final MapOverview.DirectionSample s : v.directionSamples()) {
                assertTrue(s.timeSec() >= 0 && s.timeSec() <= 120.0 + 1e-6,
                        "direction 越界: " + s.timeSec());
            }
            if (v.deathSec() != null) {
                assertTrue(v.deathSec() <= 120.0 + 1e-6, "deathSec 越界");
            }
        }
    }

    @Test
    void durationPrefersBattleEndedOverLastPosition() throws Exception {
        final ReplayProcessingResult result = processFixture();
        final ReplayReconstruction recon = result.reconstruction();
        final List<ReplayEvent> events = new ArrayList<>(recon.events());
        // 合成 BattleEndedEvent（battle-relative 150s），早于位置流最后时刻（≈302s）
        events.add(new BattleEndedEvent(
                999_999, new ReplayTimestamp(0f, 150f), 14,
                DecodeConfidence.EXACT, 2));
        result.battle().durationS = null;
        final MapOverview overview = MapOverviewBuilder.build(
                result.battle(), filteredRecon(recon, events));
        assertNotNull(overview);
        assertNotNull(overview.playback());
        assertEquals(150.0, overview.playback().durationSec(), 1e-6);
        for (final MapOverview.PlaybackEvent e : overview.playback().events()) {
            assertTrue(e.timeSec() <= 150.0 + 1e-6, "event 越过 BattleEnded 时长");
        }
    }
}
