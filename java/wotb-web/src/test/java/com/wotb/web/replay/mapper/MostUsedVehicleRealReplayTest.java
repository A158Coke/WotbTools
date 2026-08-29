package com.wotb.web.replay.mapper;

import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.replay.dto.LeaguePlayerSummaryDto;
import com.wotb.web.replay.dto.LeagueVehicleUsageDto;
import com.wotb.web.replay.dto.PreviewResponse;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实 Tankopedia 全链路回归：提交入库的 League 回放夹具 → LeagueReplays.collect →
 * Mapper.toPreviewResponse → league.playerSummaries[*].mostUsedVehicle 必须存在。
 * 修复 PR #146 验收「最常使用坦克不显示」——本测试证明后端在真实 League 批次上会生成
 * mostUsedVehicle（若线上不出现，则根因为线上后端早于 #146，需部署，而非代码缺陷）。
 */
public class MostUsedVehicleRealReplayTest {

    private static Path fixturesDir() {
        Path p = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
        for (int i = 0; i < 6; i++) {
            Path cand = p.resolve("common/fixtures/replays");
            if (Files.isDirectory(cand)) return cand;
            Path parent = p.getParent();
            if (parent == null) break;
            p = parent;
        }
        throw new IllegalStateException("common/fixtures/replays not found from " + System.getProperty("user.dir"));
    }

    @Test
    void realLeagueFixturesProduceMostUsedVehicle() throws Exception {
        final List<Path> files = List.of(
                fixturesDir().resolve("cw-training-15-14-example.wotbreplay"),
                fixturesDir().resolve("tournament-14-14-example.wotbreplay"));
        final List<Source> sources = new ArrayList<>();
        for (final Path f : files) sources.add(new Source(f.getFileName().toString(), Files.readAllBytes(f)));

        final LeagueReplays.LeagueCollectResult r = LeagueReplays.collect(sources, s -> ReplayParser.parse(s.bytes()), s -> {}, null);
        assertEquals(LeagueRatingMode.LEAGUE_RATING, r.mode(), "训练赛/联赛夹具应判定为 LEAGUE_RATING");
        assertNotNull(r.leagueBatch());

        final PreviewResponse resp = Mapper.toPreviewResponse(
                r.battles(), r.battleSourceNames(), r.duplicates(), r.failures(), Tankopedia.load(), r.leagueBatch());
        final List<LeaguePlayerSummaryDto> summaries = resp.league().playerSummaries();
        assertFalse(summaries.isEmpty());

        // 每个选手都必须有最常使用坦克（联赛为 Tier X，Tankopedia 全覆盖）
        long withVehicle = summaries.stream().filter(s -> s.mostUsedVehicle() != null).count();
        assertEquals(summaries.size(), withVehicle, "所有 league 选手都应携带 mostUsedVehicle");
        final LeaguePlayerSummaryDto any = summaries.get(0);
        assertNotNull(any.mostUsedVehicle().tankName());
        assertTrue(any.mostUsedVehicle().battles() >= 1);

        // JSON contract：league.playerSummaries[*].mostUsedVehicle 序列化为 tankId/tankName/battles
        final LeagueVehicleUsageDto muv = any.mostUsedVehicle();
        final String json = JsonMapper.builder().build().writeValueAsString(muv);
        assertTrue(json.contains("\"tankId\""), "JSON 应含 tankId: " + json);
        assertTrue(json.contains("\"tankName\""), "JSON 应含 tankName: " + json);
        assertTrue(json.contains("\"battles\""), "JSON 应含 battles: " + json);
    }
}
