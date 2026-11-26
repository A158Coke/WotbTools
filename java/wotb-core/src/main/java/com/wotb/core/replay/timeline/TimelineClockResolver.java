package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;


final class TimelineClockResolver {
    static final int MAX_FRAMES = 2400;
    static final double MAX_BATTLE_DURATION_SEC = 420.0;

    private TimelineClockResolver() {
    }


    record ClockResult(double startRawClockSec, BattleTimelineClock resolution) {
    }

    static ClockResult resolveClock(final Battle battle, final ReplayReconstruction recon) {
        final Float start = recon.battleStartRawClockSec();
        if (start != null && Float.isFinite(start)) {
            return new ClockResult(start, BattleTimelineClock.IDENTIFIED);
        }
        boolean anyBattleClock = false;
        boolean anyRawOnly = false;
        for (final ReplayEvent e : recon.events()) {
            if (e.timestamp() == null) {
                continue;
            }
            if (e.timestamp().battleClockSec() != null) {
                anyBattleClock = true;
            } else {
                anyRawOnly = true;
            }
        }
        if (anyBattleClock && !anyRawOnly) {
            return new ClockResult(0d, BattleTimelineClock.IDENTIFIED);
        }
        if (battle != null && battle.durationS != null
                && Float.isFinite(battle.durationS.floatValue()) && battle.durationS > 0) {
            for (final ReplayEvent e : recon.events()) {
                if (e instanceof RoundFinishedEvent be && be.timestamp() != null) {
                    final float raw = be.timestamp().rawClockSec();
                    if (Float.isFinite(raw) && raw >= 0) {
                        final double estimatedStart = raw - battle.durationS.doubleValue();
                        if (estimatedStart >= 0) {
                            return new ClockResult(estimatedStart, BattleTimelineClock.ESTIMATED);
                        }
                        break;
                    }
                }
            }
        }
        return new ClockResult(Double.NaN, BattleTimelineClock.UNRESOLVED);
    }

    static double resolveDurationSec(
            final Battle battle, final ReplayReconstruction recon, final double startRawClockSec) {
        if (battle != null && isPositiveFinite(battle.settlementDurationSec)) {
            return Math.min(battle.settlementDurationSec, MAX_BATTLE_DURATION_SEC);
        }
        final double roundFinished = roundFinishedBattleSec(recon, startRawClockSec);
        if (roundFinished > 0) {
            return Math.min(roundFinished, MAX_BATTLE_DURATION_SEC);
        }
        if (battle != null && isPositiveFinite(battle.durationS)) {
            return Math.min(battle.durationS, MAX_BATTLE_DURATION_SEC);
        }
        double max = 0d;
        for (final ReplayEvent e : recon.events()) {
            final double t = TimelineClock.battleClockOf(e, startRawClockSec);
            if (Double.isFinite(t) && t > max) {
                max = t;
            }
        }
        return max;
    }

    static double roundFinishedBattleSec(
            final ReplayReconstruction recon, final double startRawClockSec) {
        if (recon == null || recon.events() == null || !Double.isFinite(startRawClockSec)) {
            return Double.NaN;
        }
        for (final ReplayEvent e : recon.events()) {
            if (e instanceof RoundFinishedEvent) {
                final double t = TimelineClock.battleClockOf(e, startRawClockSec);
                if (Double.isFinite(t) && t > 0) {
                    return t;
                }
            }
        }
        return Double.NaN;
    }

    private static boolean isPositiveFinite(final Double value) {
        return value != null && Double.isFinite(value) && value > 0;
    }

}
