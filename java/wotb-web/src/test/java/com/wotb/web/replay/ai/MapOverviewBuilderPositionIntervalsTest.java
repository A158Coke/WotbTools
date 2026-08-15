package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * positionIntervals 的 EntityLeave(type-4) hard segment boundary 契约。
 *
 * <p>EntityLeave 只表示实体离开/停止存在，不代表阵亡，也不代表「灭点」（位置流覆盖 ≠ 点亮）。
 * 每一次 leave 都强制结束当前 coverage run；leave 后的第一条 position 无论 gap 大小都开启新 run。
 * 无 leave 时保留 gap &gt; 5s 分段；deathSec 最后 clamp，阵亡后的 interval 不出现；
 * 任何区间 startSec ≤ endSec。</p>
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

    private static List<ReplayEvent> leaves(final long entityId, final double... times) {
        final List<ReplayEvent> events = new ArrayList<>();
        for (final double t : times) {
            events.add(new EntityRemovedEvent(
                    events.size() + 1, new ReplayTimestamp((float) t, null), 4,
                    DecodeConfidence.EXACT, (int) entityId));
        }
        return events;
    }

    private static List<MapOverview.PositionInterval> intervals(
            final double[] pointTimes,
            final double[] leaveTimes,
            final Double deathSec) {
        final Map<Integer, List<MapOverviewBuilder.Position>> byEntity = new LinkedHashMap<>();
        byEntity.put(100, positions(pointTimes));
        final MapOverviewBuilder.Positions positions = new MapOverviewBuilder.Positions(byEntity);
        return MapOverviewBuilder.positionIntervals(
                List.of(100), positions, leaves(100, leaveTimes), 0f, deathSec, 300.0);
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
    void leaveThenReReportGap2sOpensNewInterval() {
        // 10~59 位置上报 → leave@60 → 62/64/66 重新上报（gap 3s ≤ 5s）：
        // leave 必须强制关段 [10,60]，62 开启新 interval [62,66]，不得被 gap heuristic 吞掉。
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59, 62, 64, 66},
                new double[]{60}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "leave 前区间必须在 leave 时刻关闭: " + ivs);
        assertTrue(has(ivs, 62, 66), "leave 后 2s 重新上报必须开启新 interval: " + ivs);
    }

    @Test
    void leaveThenReReportGap10sKeepsBothIntervals() {
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120},
                new double[]{60}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "leave 前区间必须保留: " + ivs);
        assertTrue(has(ivs, 70, 120), "leave 后 gap 10s 重新上报区间必须保留: " + ivs);
    }

    @Test
    void multipleLeaveCyclesProduceAllIntervals() {
        // 10~40 → leave@41 → 43~70 → leave@71 → 72~100（段内间距 ≤5s）：三个有效 interval
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 43, 47, 50, 55, 60, 65, 70, 72, 75, 80, 85, 90, 95, 100},
                new double[]{41, 71}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 41), "第一生命周期: " + ivs);
        assertTrue(has(ivs, 43, 71), "第二生命周期（gap 2s 也须新开）: " + ivs);
        assertTrue(has(ivs, 72, 100), "第三生命周期: " + ivs);
    }

    @Test
    void leaveBeforeFirstPositionKeepsRun() {
        // leave@5 早于首个 position@10：属于前一生涯周期，不得截断/丢弃 10~30
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30},
                new double[]{5}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 30), "leave 在首个 position 之前不得影响后续 run: " + ivs);
    }

    @Test
    void noLeaveKeepsGapSplitSemantics() {
        // 无 leave：gap 7s > 5s → 两段（段内间距 ≤5s）
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 27, 31, 35, 40},
                new double[]{}, null);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 20), "第一段（gap 分段）: " + ivs);
        assertTrue(has(ivs, 27, 40), "第二段（gap 分段）: " + ivs);
    }

    @Test
    void deathSecAfterReReportClampsLaterInterval() {
        // deathSec=90 在重新上报区间中间：clamp 到 90
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120},
                new double[]{60}, 90.0);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "leave 前区间: " + ivs);
        assertTrue(has(ivs, 70, 90), "重新上报区间末端必须被 deathSec clamp: " + ivs);
    }

    @Test
    void deathSecBeforeReReportRemovesLaterInterval() {
        // deathSec=65 在重新上报之前：阵亡后的 interval 不得出现
        final List<MapOverview.PositionInterval> ivs = intervals(
                new double[]{10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 80, 85, 90},
                new double[]{60}, 65.0);
        assertNoInvertedInterval(ivs);
        assertTrue(has(ivs, 10, 60), "阵亡前区间保留: " + ivs);
        assertFalse(ivs.stream().anyMatch(iv -> Math.abs(iv.startSec() - 70.0) < EPS),
                "阵亡后的重新上报 interval 不得出现: " + ivs);
    }
}
