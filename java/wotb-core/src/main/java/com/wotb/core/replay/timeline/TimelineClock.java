package com.wotb.core.replay.timeline;

import com.wotb.core.replay.event.ReplayEvent;

public final class TimelineClock {
    private TimelineClock() {
    }

    public static double battleClockOf(final ReplayEvent event, final double battleStartRawClockSec) {
        if (event.timestamp() == null) {
            return Double.NaN;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        return event.timestamp().rawClockSec() - battleStartRawClockSec;
    }

    public static boolean hasMixedClockDomains(final java.util.List<ReplayEvent> events) {
        boolean anyBattle = false;
        boolean anyRawOnly = false;
        if (events != null) {
            for (final ReplayEvent e : events) {
                if (e.timestamp() == null) {
                    continue;
                }
                if (e.timestamp().battleClockSec() != null) {
                    anyBattle = true;
                } else {
                    anyRawOnly = true;
                }
            }
        }
        return anyBattle && anyRawOnly;
    }
}
