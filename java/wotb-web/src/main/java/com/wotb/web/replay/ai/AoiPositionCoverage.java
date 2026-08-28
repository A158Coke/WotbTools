package com.wotb.web.replay.ai;

import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.web.replay.dto.MapOverview;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * 位置上报覆盖区间的唯一 canonical 推导（共享于 {@link BattlePlaybackAdapter} 与
 * {@link MapOverviewBuilder}，禁止两套 interval derivation）。
 *
 * <p>区间 = canonical AoI observed segment（ReplayAoiLifecycle）∩ 实际位置存在范围，
 * 再经 deathSec / duration clamp。段段之间（UNKNOWN_AOI gap）不产生区间；
 * 同一 open segment 内<b>不</b>做 5 秒 packet-gap splitting（静止车辆即使 >5s 无 Type10
 * 也不产生 POSITION_STALE）。</p>
 */
public final class AoiPositionCoverage {

    private AoiPositionCoverage() {
    }

    /**
     * 为给定实体集（同账号多个实体可 re-entry 合并）推导位置上报覆盖区间。
     *
     * @param allSegments  全部 canonical AoI 观测段（battle-relative；来源 ReplayAoiLifecycle.build）
     * @param entityIds    该账号的实体 ID 集合
     * @param positionTimes 该账号实体的位置样本时间（battle-relative，升序，可含跨实体）
     * @param deathSec     阵亡时刻（可为 null = 未阵亡/未知）
     * @param duration     战斗时长（秒）
     * @return 位置覆盖区间（按 start 升序、互相不重叠）
     */
    public static List<MapOverview.PositionInterval> intervals(
            final List<AoiObservationSegment> allSegments,
            final List<Integer> entityIds,
            final List<Double> positionTimes,
            final Double deathSec,
            final double duration) {
        if (allSegments == null || entityIds == null || entityIds.isEmpty()
                || positionTimes == null || positionTimes.isEmpty()) {
            return List.of();
        }
        final Set<Integer> idSet = Set.copyOf(entityIds);
        final List<AoiObservationSegment> segments = allSegments.stream()
                .filter(s -> idSet.contains(s.entityId()))
                .sorted(Comparator.comparingDouble(AoiObservationSegment::observedFromSec))
                .toList();

        final List<double[]> raw = new ArrayList<>();
        for (final AoiObservationSegment seg : segments) {
            final double segStart = seg.observedFromSec();
            double segEnd = seg.absentFromSec() != null ? seg.absentFromSec() : duration;
            if (segEnd > duration) {
                segEnd = duration;
            }
            if (!(segEnd > segStart - 1e-9)) {
                continue; // 零长段（无观测）/段被 duration 截到空
            }
            // 实际位置存在（该段内第一条位置样本）；段内无位置 → 不产生区间
            Double firstPos = null;
            for (final double pt : positionTimes) {
                if (pt < segStart - 1e-9) {
                    continue;
                }
                if (pt > segEnd + 1e-9) {
                    break;
                }
                firstPos = pt;
                break;
            }
            if (firstPos == null) {
                continue;
            }
            double start = firstPos;
            double end = segEnd;
            if (deathSec != null) {
                if (start > deathSec + 1e-6) {
                    continue; // 阵亡后重新出现 → 不出现区间
                }
                end = Math.min(end, deathSec);
            }
            if (end >= start - 1e-6) {
                raw.add(new double[]{start, Math.max(start, end)});
            }
        }
        raw.sort(Comparator.comparingDouble(a -> a[0]));

        final List<MapOverview.PositionInterval> merged = new ArrayList<>();
        for (final double[] iv : raw) {
            if (merged.isEmpty()
                    || iv[0] - merged.get(merged.size() - 1).endSec() > 1e-6) {
                merged.add(new MapOverview.PositionInterval(iv[0], iv[1]));
            } else {
                final MapOverview.PositionInterval last = merged.get(merged.size() - 1);
                merged.set(merged.size() - 1, new MapOverview.PositionInterval(
                        last.startSec(), Math.max(last.endSec(), iv[1])));
            }
        }
        return merged;
    }
}
