package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * positionIntervals 的 canonical AoI segment 契约（P0-1）：区间 = AoI observed segment ∩ 实际位置存在，
 * 再经 death/duration clamp。同一 open segment 内<b>不做</b> 5 秒 packet-gap splitting；EntityLeave(type-4)
 * 收段，leave 后重新上报开新段；段段之间（UNKNOWN_AOI gap）不产生区间；区间 start ≤ end。
 */
class MapOverviewBuilderPositionIntervalsTest {

    private static final double EPS = 1e-6;

    private static MapOverviewBuilder.Position pos(final double t) {
        return new MapOverviewBuilder.Position(t, 100, 100, null);
    }

    private static List<MapOverviewBuilder.Position> positions(final double... times) {
        final List<MapOverviewBuilder.Position> pts = new ArrayList<>();
        for (final double t : times) {
            pts.add(pos(t));
        }
        return pts;
    }

    private static List<ReplayEvent> events(final long entityId,
                                            final double[] pointTimes, final double[] leaveTimes) {
        final List<ReplayEvent> events = new ArrayList<>();
        int seq = 0;
        for (final double t : pointTimes) {
            events.add(new PositionChangedEvent(seq++, new ReplayTimestamp((float) t, null), 10,
                    DecodeConfidence.EXACT, (int) entityId, 0, 0, 100f, 0f, 100f, 0f, 0f, 0f, 0f, 0f, 0f, 0));
        }
        for (final double t : leaveTimes) {
            events.add(new EntityRemovedEvent(seq++, new ReplayTimestamp((float) t, null), 4,
                    DecodeConfidence.EXACT, (int) entityId));
        }
        return events;
    }

    private static List<MapOverview.PositionInterval> intervals(
            final double[] pointTimes, final double[] leaveTimes, final Double deathSec) {
        final Map<Integer, List<MapOverviewBuilder.Position>> byEntity = new LinkedHashMap<>();
        byEntity.put(100, positions(pointTimes));
        final MapOverviewBuilder.Positions positions = new MapOverviewBuilder.Positions(byEntity);
        return MapOverviewBuilder.positionIntervals(
                List.of(100), positions, events(100, pointTimes, leaveTimes), 0f, deathSec, 300.0);
    }

    private static void assertNoInvertedInterval(final List<MapOverview.PositionInterval> ivs) {
        for (final MapOverview.PositionInterval iv : ivs) {
            assertTrue(iv.startSec() <= iv.endSec() + EPS, "不得产生倒置区间: " + iv);
        }
    }

    private static boolean has(final List<MapOverview.PositionInterval> ivs,
                               final double start, final double end) {
        return ivs.stream().anyMatch(iv -> Math.abs(iv.startSec() - start) < EPS
                && Math.abs(iv.endSec() - end) < EPS);
    }

    @Test
    void openSegmentDoesNotSplitOnQuietGap() {
        // P0-1 回归：type10@10，无 Type4 → 段 [10, battleEnd) 保持打开；15/20 不能在 >5s 无包时
        // 自动发生 POSITION_STALE（禁止 5 秒 packet-gap splitting）。下一 Type10@25 属同段。
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 25}, new double[]{}, null);
        assertNoInvertedInterval(ivs);
        assertEquals(1, ivs.size(), "同一 open segment 不得因静止 >5s 分裂成两段: " + ivs);
        assertTrue(has(ivs, 10, 300), "区间应覆盖整个 open segment: " + ivs);
    }

    @Test
    void leaveClosesSegmentAndReentryOpensNew() {
        // type10@10 → type4@20（leave）→ type5@31 / type10@32 重入：20..31 = UNKNOWN_AOI gap 无区间。
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 32}, new double[]{20}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 20), "leave 前区间必须在 leave 时刻关闭（10..20）: " + ivs);
        assertTrue(has(ivs, 32, 300), "re-entry 后重开区间（32..battleEnd）: " + ivs);
        // gap（20..31）不得产生任何区间
        assertEquals(2, ivs.size(), "20..31 UNKNOWN_AOI gap 不得产生区间: " + ivs);
    }

    @Test
    void leaveThenReReportGap2sOpensNewInterval() {
        // 10~59 上报 → leave@60 → 62/64/66 重报：leave 强制收段 [10,60]，62 开新段（即使 gap 仅 2s 也不吞掉）。
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59, 62, 64, 66},
                new double[]{60}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "leave 前区间必须在 leave 时刻关闭: " + ivs);
        assertTrue(has(ivs, 62, 300), "leave 后重新上报必须开启新区间（延续至段末）: " + ivs);
    }

    @Test
    void leaveThenReReportGap10sKeepsBothIntervals() {
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120},
                new double[]{60}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "leave 前区间必须保留: " + ivs);
        assertTrue(has(ivs, 70, 300), "leave 后 gap 10s 重新上报区间必须保留: " + ivs);
    }

    @Test
    void multipleLeaveCyclesProduceAllIntervals() {
        // 10~40 → leave@41 → 43~70 → leave@71 → 72~100：三个有效 interval（末段延续至 battleEnd）。
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 43, 47, 50, 55, 60, 65, 70, 72, 75, 80, 85, 90, 95, 100},
                new double[]{41, 71}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 41), "第一生命周期: " + ivs);
        assertTrue(has(ivs, 43, 71), "第二生命周期（gap 2s 也须新开）: " + ivs);
        assertTrue(has(ivs, 72, 300), "第三生命周期（延续至 battleEnd）: " + ivs);
    }

    @Test
    void leaveBeforeFirstPositionKeepsRun() {
        // leave@5 早于首个 position@10：属前一生涯周期，不得截断/丢弃 10~battleEnd。
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30},
                new double[]{5}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 300), "leave 在首个 position 之前不得影响后续 run: " + ivs);
    }

    @Test
    void deathSecAfterReReportClampsLaterInterval() {
        // deathSec=90 在重新上报区间中间：clamp 到 90（leave 前区间不受影响）。
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120},
                new double[]{60}, 90.0);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "leave 前区间: " + ivs);
        assertTrue(has(ivs, 70, 90), "重新上报区间末端必须被 deathSec clamp: " + ivs);
    }

    @Test
    void deathSecBeforeReReportRemovesLaterInterval() {
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 80, 85, 90},
                new double[]{60}, 65.0);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "阵亡前区间保留: " + ivs);
        assertEquals(1, ivs.size(), "阵亡后的重新上报 interval 不得出现: " + ivs);
    }
}
