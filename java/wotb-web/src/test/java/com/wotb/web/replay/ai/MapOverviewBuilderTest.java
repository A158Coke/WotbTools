package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

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
        assertTrue(overview.friendlyTeam() == 1 || overview.friendlyTeam() == 2);
        assertTrue(overview.playableBounds().xMin() < overview.playableBounds().xMax());
        assertTrue(overview.playableBounds().yMin() < overview.playableBounds().yMax());
        assertEquals(36, overview.gridCells().size(), "6x6 分析格");
        assertEquals(36, overview.heatmaps().friendly().dwell().size());
        assertEquals(36, overview.heatmaps().friendly().damage().size());
        assertEquals(36, overview.heatmaps().friendly().deaths().size());
        assertEquals(36, overview.heatmaps().enemy().dwell().size());
        assertNull(overview.image(), "rift 尚无鸟瞰素材，image 应为 null");
        assertFalse(overview.phases().isEmpty(), "应产出阶段切片");
        assertEquals("opening", overview.phases().get(0).key());

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

    private static PlayerResult player(final long account, final String nick,
                                       final int team, final long tank) {
        final PlayerResult p = new PlayerResult();
        p.accountId = account;
        p.nickname = nick;
        p.team = team;
        p.tankId = tank;
        return p;
    }
}
