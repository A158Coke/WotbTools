package com.wotb.web.replay.ai;

import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

/**
 * 手动探针（不进 CI）：对任意真实回放输出 mapOverview 统计，
 * 用于验证 neptune/desert_train 等素材路径的端到端聚合。
 * Run: {@code mvn -pl wotb-web -am test -Dtest=MapOverviewProbeTest -Dprobe.replay=<file>}
 */
class MapOverviewProbeTest {

    @Test
    void probe() throws Exception {
        final String path = System.getProperty("probe.replay");
        Assumptions.assumeTrue(path != null, "set -Dprobe.replay=<file>");
        final byte[] bytes = Files.readAllBytes(Path.of(path));
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new Source(Path.of(path).getFileName().toString(), bytes),
                        ReplayProcessingOptions.full());
        System.out.println("battle map=" + (result.battle() == null ? null : result.battle().mapName)
                + " duration=" + (result.battle() == null ? null : result.battle().durationS)
                + " players=" + (result.battle() == null ? 0 : result.battle().players.size())
                + " recon=" + (result.reconstruction() != null));
        final MapOverview o = MapOverviewBuilder.build(result.battle(), result.reconstruction());
        if (o == null) {
            System.out.println("mapOverview = null (降级)");
            return;
        }
        System.out.println("mapCode=" + o.mapCode() + " display=" + o.displayName()
                + " friendlyTeam=" + o.friendlyTeam()
                + " image=" + (o.image() == null ? null : o.image().file())
                + " cells=" + o.gridCells().size() + " spawns=" + o.spawnPoints().size()
                + " phases=" + o.phases());
        for (final String team : new String[]{"friendly", "enemy"}) {
            final MapOverview.Layer layer = "friendly".equals(team) ? o.heatmaps().friendly() : o.heatmaps().enemy();
            final double dwell = layer.dwell().stream().mapToDouble(Double::doubleValue).sum();
            final double dmg = layer.damage().stream().mapToDouble(Double::doubleValue).sum();
            final double deaths = layer.deaths().stream().mapToDouble(Double::doubleValue).sum();
            System.out.printf(Locale.ROOT, "heatmap %s: dwell=%.0f damage=%.0f deaths=%.0f%n",
                    team, dwell, dmg, deaths);
        }
        System.out.println("routes=" + o.routes().size());
        for (final MapOverview.Route r : o.routes()) {
            System.out.printf(Locale.ROOT, "  acc=%d team=%d %-14s pts=%d obs[%.1f..%.1f] death=%s%n",
                    r.accountId(), r.team(), r.playerName(), r.points().size(),
                    r.firstObservedSec(), r.lastObservedSec(),
                    r.deathSec() == null ? "-" : String.format(Locale.ROOT, "%.1f", r.deathSec()));
        }
    }
}
