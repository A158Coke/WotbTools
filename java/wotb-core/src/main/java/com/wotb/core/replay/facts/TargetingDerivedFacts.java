package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.AimRayStateEvent;
import com.wotb.core.replay.event.GunMarkerSizeEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.TargetingInfoSnapshotEvent;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Recorder targeting fact joiner: method36 + Type31 marker size + Type39 aim-ray geometry. */
public final class TargetingDerivedFacts {

    /** Type31/39 run at ~120 Hz; older samples than this are not attached to a shot. */
    static final double HIGH_RATE_PRE_SHOT_MAX_AGE_SEC = 0.10;

    private TargetingDerivedFacts() {
    }

    public static List<TargetingShotPair> pair(
            final List<ShotFact> shots,
            final List<ReplayEvent> events,
            final Double startRawClockSec) {
        if (shots == null || events == null) {
            return List.of();
        }
        final List<TargetingInfoSnapshotEvent> snapshots = new ArrayList<>();
        final List<GunMarkerSizeEvent> markerSamples = new ArrayList<>();
        final List<AimRayStateEvent> aimSamples = new ArrayList<>();
        for (final ReplayEvent e : events) {
            switch (e) {
                case TargetingInfoSnapshotEvent t -> snapshots.add(t);
                case GunMarkerSizeEvent g -> markerSamples.add(g);
                case AimRayStateEvent a -> aimSamples.add(a);
                default -> { }
            }
        }
        final Comparator<ReplayEvent> byTime = Comparator
                .comparingDouble((ReplayEvent e) -> clockOf(e, startRawClockSec))
                .thenComparingInt(ReplayEvent::sequence);
        snapshots.sort(byTime);
        markerSamples.sort(byTime);
        aimSamples.sort(byTime);

        final List<TargetingShotPair> out = new ArrayList<>();
        for (final ShotFact shot : shots) {
            if (!shot.recorderShot() || !Double.isFinite(shot.launchTimeSec())) {
                continue;
            }
            final TargetingInfoSnapshotEvent pre36 = latestAtOrBefore(snapshots, shot.launchTimeSec(), startRawClockSec);
            final TargetingInfoSnapshotEvent post36 = firstAfter(snapshots, shot.launchTimeSec(), startRawClockSec);
            final GunMarkerSizeEvent marker = latestAtOrBefore(markerSamples, shot.launchTimeSec(), startRawClockSec);
            final AimRayStateEvent aim = latestAtOrBefore(aimSamples, shot.launchTimeSec(), startRawClockSec);

            final Double before = pre36 == null ? null : pre36.dispersionBloomRaw();
            final Double after = post36 == null ? null : post36.dispersionBloomRaw();
            final Double increase = before != null && after != null ? after - before : null;

            final boolean markerFresh = marker != null
                    && shot.launchTimeSec() - clockOf(marker, startRawClockSec) <= HIGH_RATE_PRE_SHOT_MAX_AGE_SEC;
            final boolean aimFresh = aim != null
                    && shot.launchTimeSec() - clockOf(aim, startRawClockSec) <= HIGH_RATE_PRE_SHOT_MAX_AGE_SEC;

            if (pre36 == null && !markerFresh && !aimFresh) {
                continue;
            }
            out.add(new TargetingShotPair(
                    shot.shotId(),
                    pre36 == null ? null : pre36.turretYawRad(),
                    pre36 == null ? null : pre36.gunPitchRad(),
                    pre36 == null ? null : pre36.aimingTimeScalarRaw(),
                    before,
                    after,
                    increase,
                    markerFresh ? marker.markerSizeRaw() : null,
                    aimFresh ? aim.worldYawDeg() : null,
                    aimFresh ? aim.worldPitchDeg() : null,
                    aimFresh ? aim.aimRayPointX() : null,
                    aimFresh ? aim.aimRayPointY() : null,
                    aimFresh ? aim.aimRayPointZ() : null));
        }
        out.sort(Comparator.comparingInt(TargetingShotPair::shotId));
        return List.copyOf(out);
    }

    private static <T extends ReplayEvent> T latestAtOrBefore(
            final List<T> events,
            final double time,
            final Double startRawClockSec) {
        T latest = null;
        for (final T event : events) {
            final double t = clockOf(event, startRawClockSec);
            if (t <= time + 1e-9) {
                latest = event;
            } else {
                break;
            }
        }
        return latest;
    }

    private static <T extends ReplayEvent> T firstAfter(
            final List<T> events,
            final double time,
            final Double startRawClockSec) {
        for (final T event : events) {
            if (clockOf(event, startRawClockSec) > time + 1e-9) {
                return event;
            }
        }
        return null;
    }

    private static double clockOf(final ReplayEvent e, final Double startRawClockSec) {
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
