package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实失败回放回归 probe（docs/current-plan.md §12/§13-G，可重复运行、无样本自动跳过）：
 * 样本 `20260817_2021____WildCat__A178_SPHT_1161423218062589123(2).wotbreplay` 应放置于
 * `common/data/`（本地样本目录，不入库）。probe 验证：canonical Team timeline 可构建；
 * Focus selector 能找到连续减员窗口；窗口事实与权威死亡时间线一致；不依赖结算终局反推过去。
 * <p>CI 无样本时跳过（与其它 *ProbeTest 一致），用户放好样本后自动回归。</p>
 */
class TeamReviewRealReplayProbeTest {

    private static final String SAMPLE = "data/20260817_2021____WildCat__A178_SPHT_1161423218062589123(2).wotbreplay";

    @Test
    void realFailureReplayFindsCollapseWindow() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common").normalize();
        final Path file = common.resolve(SAMPLE);
        if (!Files.exists(file)) {
            System.out.println("\n===== SKIP（真实失败回放缺失）: " + SAMPLE);
            System.out.println("===== 请将 20260817_2021____WildCat__A178_SPHT_1161423218062589123(2).wotbreplay 放到 "
                    + common.toAbsolutePath() + " 后重跑本 probe");
            return;
        }
        final byte[] bytes = Files.readAllBytes(file);
        final Battle battle = ReplayParser.parse(bytes);
        assertNotNull(battle, "真实失败回放必须能解析");
        assertNotNull(battle.recorderResult(), "必须能解析录像者");
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        assertNotNull(recon, "必须能重建事件流");

        final int perspectiveTeam = battle.recorderResult().team;
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.team(perspectiveTeam));
        assertTrue(result.usable(), "真实失败回放必须构建 valid canonical Team timeline: "
                + result.validation().errors());
        final BattleTimeline timeline = result.timeline();
        assertTrue(timeline.durationSec() > 0, "timeline 必须有正时长");

        // 权威本方死亡时间线（结算）；死亡时刻可能为原始时钟域，转 battle-relative 比较
        final double startRaw = timeline.battleStartRawClockSec();
        final List<PlayerResult> friendlyDeaths = battle.players == null ? List.of()
                : battle.players.stream()
                        .filter(p -> p != null && p.team == perspectiveTeam && !p.survived)
                        .sorted(java.util.Comparator.comparingDouble(PlayerResultFormat::deathSec))
                        .toList();
        final List<Double> relativeDeaths = friendlyDeaths.stream()
                .map(p -> {
                    final double raw = PlayerResultFormat.deathSec(p);
                    return raw > startRaw ? raw - startRaw : raw;
                })
                .toList();
        System.out.println("===== 真实失败回放: " + file.getFileName());
        System.out.println("map=" + battle.mapName + " arenaBonusType=" + battle.arenaBonusType
                + " duration=" + timeline.durationSec() + "s startRaw=" + startRaw
                + " friendlyDeaths=" + relativeDeaths);

        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        System.out.println("focus windows=" + windows.size());
        for (final TimelineFocusWindowSelector.FocusWindow w : windows) {
            System.out.println("  WINDOW [" + w.startSec() + "," + w.endSec() + "]"
                    + " friendlyDeaths=" + w.friendlyDeaths() + " enemyDeaths=" + w.enemyDeaths()
                    + " hp=" + Math.round(w.hpSwing()) + " reasons=" + w.reasons());
        }
        // 验收（§12）：必须找到至少一个包含连续减员（本方 ≥2 死）的 Focus Window
        final TimelineFocusWindowSelector.FocusWindow collapse = windows.stream()
                .filter(w -> w.friendlyDeaths() >= 2)
                .findFirst().orElse(null);
        assertNotNull(collapse,
                "必须找到连续减员 Focus Window（权威本方死亡 battle-relative: " + relativeDeaths + "）");
        System.out.println("collapse window: " + collapse.startSec() + "-" + collapse.endSec()
                + " friendlyDeaths=" + collapse.friendlyDeaths() + " enemyDeaths=" + collapse.enemyDeaths());

        // 窗口事实与权威死亡时间线一致：最早权威阵亡应落在窗口（含填充）内
        final double earliest = relativeDeaths.stream()
                .filter(d -> d > 0)
                .mapToDouble(Double::doubleValue).min().orElse(Double.NaN);
        if (Double.isFinite(earliest)) {
            assertTrue(earliest >= collapse.startSec() - 20.0,
                    "最早权威阵亡必须接近窗口起点: " + earliest + " vs " + collapse.startSec());
        }
        // 不 future leak：窗口事件时间必须 ≤ 窗口终点
        for (final BattleDelta d : collapse.events()) {
            assertTrue(d.timeSec() <= collapse.endSec() + 1e-6,
                    "窗口事件不得超出窗口终点: " + d.timeSec());
        }
    }
}