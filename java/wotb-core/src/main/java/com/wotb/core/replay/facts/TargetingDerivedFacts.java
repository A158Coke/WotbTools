package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.TargetingInfoSnapshotEvent;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 瞄准派生事实构建器（计划 §C6/C7，deterministic facts only）。
 *
 * <p>对每个 recorder 射击（ShotFact）配对 method36 PRE（发射前最近）与 POST
 * （发射后最近），产出物理 role 已 PROVEN 的 scalar；不做 AI 判断
 * （不判 bad snapshot / poor aim / wrong shot）。</p>
 */
public final class TargetingDerivedFacts {

    private TargetingDerivedFacts() {
    }

    /**
     * 为每个 recorder 射击构建瞄准 PRE/POST 配对。
     *
     * @param shots    canonical ShotFact 列表（仅 recorderShot=true 的会被配对）
     * @param events   全部领域事件（用于查找 method36）
     * @param startRawClockSec battle start 原始时钟（可为 null → 退回 raw）
     */
    public static List<TargetingShotPair> pair(
            final List<ShotFact> shots,
            final List<ReplayEvent> events,
            final Double startRawClockSec) {
        if (shots == null || events == null) {
            return List.of();
        }
        final List<TargetingInfoSnapshotEvent> snapshots = new ArrayList<>();
        for (final ReplayEvent e : events) {
            if (e instanceof TargetingInfoSnapshotEvent t) {
                snapshots.add(t);
            }
        }
        snapshots.sort(Comparator.comparingDouble((TargetingInfoSnapshotEvent t) ->
                        clockOf(t, startRawClockSec))
                .thenComparingInt(TargetingInfoSnapshotEvent::sequence));

        final List<TargetingShotPair> out = new ArrayList<>();
        for (final ShotFact shot : shots) {
            if (!shot.recorderShot() || !Double.isFinite(shot.launchTimeSec())) {
                continue;
            }
            TargetingInfoSnapshotEvent pre = null;
            TargetingInfoSnapshotEvent post = null;
            for (final TargetingInfoSnapshotEvent t : snapshots) {
                final double tSec = clockOf(t, startRawClockSec);
                if (tSec <= shot.launchTimeSec() + 1e-9) {
                    pre = t;
                } else {
                    post = t;
                    break;
                }
            }
            if (pre == null) {
                continue;
            }
            final Double before = pre.dispersionBloomRaw();
            final Double after = post == null ? null : post.dispersionBloomRaw();
            final Double increase = before != null && after != null
                    ? after - before : null;
            out.add(new TargetingShotPair(
                    shot.shotId(),
                    pre.turretYawRad(),
                    pre.gunPitchRad(),
                    pre.aimingTimeScalarRaw(),
                    before,
                    after,
                    increase));
        }
        out.sort(Comparator.comparingInt(TargetingShotPair::shotId));
        return List.copyOf(out);
    }

    private static double clockOf(final TargetingInfoSnapshotEvent e,
                                  final Double startRawClockSec) {
        if (e.timestamp() == null) {
            return Double.NaN;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        if (startRawClockSec == null || !Double.isFinite(startRawClockSec)) {
            return e.timestamp().rawClockSec();
        }
        return e.timestamp().rawClockSec() - startRawClockSec;
    }
}
