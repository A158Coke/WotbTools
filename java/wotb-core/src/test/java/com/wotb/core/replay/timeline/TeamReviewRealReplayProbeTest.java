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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实失败回放 Golden Probe（docs/current-plan.md §12/§13-G，可重复运行、无样本自动跳过）：
 * 样本 `20260817_2021____WildCat__A178_SPHT_1161423218062589123(2).wotbreplay` 应放置于
 * `common/data/`（本地样本目录，不入库）。
 * <p><b>PR #103 review §7：Golden acceptance 必须是 assertion，不是 println。</b>
 * 样本存在时硬断言（来自已确认的真实 canonical facts，CHANGELOG 报告 core 约 109–128s）：
 * <ul>
 *   <li>Top collapse core 必须是 3:1（本方 3 死、对方 1 死），不允许 3:2 通过；</li>
 *   <li>BEFORE 7v7 → AFTER 4v6（friendlyAlive/enemyAlive 逐项）；</li>
 *   <li>core 时间窗口接近真实 canonical 109–128s（容差 ±8s，不使用 ±25s 这种无 gate 价值的宽松检查）；</li>
 *   <li>窗口事件不 future leak（全部在 [startSec, endSec] 内）。</li>
 * </ul>
 * 若未来底层时间解析发生有意修正，本测试<b>必须失败</b>，由人工确认新的 canonical facts 并更新 golden——
 * 绝不静默接受、绝不把 assert 降级为 print。</p>
 * <p>CI 无样本时跳过（与其它 *ProbeTest 一致），用户放好样本后自动回归。</p>
 */
class TeamReviewRealReplayProbeTest {

    private static final String SAMPLE = "data/20260817_2021____WildCat__A178_SPHT_1161423218062589123(2).wotbreplay";

    /**
     * Golden core 时间（真实 canonical facts，PR #103 已确认约 109–128s）；容差仅供时钟舍入/取帧。
     */
    private static final double GOLDEN_START_SEC = 109.0;
    private static final double GOLDEN_END_SEC = 128.0;
    private static final double CORE_TIME_TOLERANCE_SEC = 8.0;

    @Test
    void realFailureReplayGoldenCollapseIsHardAsserted() throws Exception {
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
                + " friendlyDeaths(battle-relative)=" + relativeDeaths);

        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        System.out.println("focus windows=" + windows.size());
        for (final TimelineFocusWindowSelector.FocusWindow w : windows) {
            System.out.println("  WINDOW [" + w.startSec() + "," + w.endSec() + "]"
                    + " friendlyDeaths=" + w.friendlyDeaths() + " enemyDeaths=" + w.enemyDeaths()
                    + " hp=" + Math.round(w.hpSwing()) + " reasons=" + w.reasons());
        }
        final TimelineFocusWindowSelector.FocusWindow collapse = windows.stream()
                .filter(w -> w.friendlyDeaths() >= 2)
                .findFirst().orElse(null);
        assertNotNull(collapse,
                "必须找到连续减员 Focus Window（权威本方死亡 battle-relative: " + relativeDeaths + "）");
        System.out.println("collapse core: " + collapse.startSec() + "-" + collapse.endSec()
                + " friendlyDeaths=" + collapse.friendlyDeaths() + " enemyDeaths=" + collapse.enemyDeaths()
                + " BEFORE=" + collapse.before().friendlyAlive() + "v" + collapse.before().enemyAlive()
                + " AFTER=" + collapse.after().friendlyAlive() + "v" + collapse.after().enemyAlive());

        // ===== Golden hard assertions（PR #103 review §7.2；绝不降级为 print-only） =====
        assertEquals(3, collapse.friendlyDeaths(),
                "Golden: collapse core 必须是本方 3 死（真实 canonical 3:1）: " + collapse);
        assertEquals(1, collapse.enemyDeaths(),
                "Golden: collapse core 必须是对方 1 死（真实 canonical 3:1，非 3:2）: " + collapse);
        assertEquals(7, collapse.before().friendlyAlive(),
                "Golden: BEFORE friendlyAlive 必须为 7（7v7 开局）: " + collapse);
        assertEquals(7, collapse.before().enemyAlive(),
                "Golden: BEFORE enemyAlive 必须为 7（7v7 开局）: " + collapse);
        assertEquals(4, collapse.after().friendlyAlive(),
                "Golden: AFTER friendlyAlive 必须为 4: " + collapse);
        assertEquals(6, collapse.after().enemyAlive(),
                "Golden: AFTER enemyAlive 必须为 6: " + collapse);
        // core 时间窗口接近真实 canonical 109–128s（±8s 容差；拒绝 ±25s 级宽松检查）
        assertTrue(Math.abs(collapse.startSec() - GOLDEN_START_SEC) <= CORE_TIME_TOLERANCE_SEC,
                "Golden: collapse core 起点应接近 " + GOLDEN_START_SEC + "s（实际 " + collapse.startSec() + "s）: " + collapse);
        assertTrue(Math.abs(collapse.endSec() - GOLDEN_END_SEC) <= CORE_TIME_TOLERANCE_SEC,
                "Golden: collapse core 终点应接近 " + GOLDEN_END_SEC + "s（实际 " + collapse.endSec() + "s）: " + collapse);

        // 窗口事实与权威死亡时间线一致：最早权威阵亡应落在 core 起点附近（core 无 padding）
        final double earliest = relativeDeaths.stream()
                .filter(d -> d > 0)
                .mapToDouble(Double::doubleValue).min().orElse(Double.NaN);
        if (Double.isFinite(earliest)) {
            assertTrue(earliest >= collapse.startSec() - 20.0,
                    "最早权威阵亡必须接近窗口起点: " + earliest + " vs " + collapse.startSec());
        }
        // 不 future leak：core window 无 padding，窗口事件时间必须 ≤ 窗口终点且 ≥ 窗口起点
        for (final BattleDelta d : collapse.events()) {
            assertTrue(d.timeSec() <= collapse.endSec() + 1e-6,
                    "窗口事件不得超出窗口终点: " + d.timeSec());
            assertTrue(d.timeSec() >= collapse.startSec() - 1e-6,
                    "窗口事件不得早于窗口起点: " + d.timeSec());
        }
    }
}
