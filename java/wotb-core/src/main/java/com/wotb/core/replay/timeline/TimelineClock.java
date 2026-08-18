package com.wotb.core.replay.timeline;

import com.wotb.core.replay.event.ReplayEvent;

/**
 * battle-relative 时间工具：优先事件自带的 battleClockSec，否则 rawClock - battleStartRawClockSec。
 * raw clock 保留为 provenance/debug，任何正式 Timeline 战术语义一律使用 battle-relative 时间。
 */
public final class TimelineClock {
    private TimelineClock() {
    }

    /** 事件在 battle-relative 时间轴上的时刻；无 battle start 时退回 raw（调用方必须保证 start 可用）。 */
    public static double battleClockOf(final ReplayEvent event, final double battleStartRawClockSec) {
        if (event.timestamp() == null) {
            return 0d;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        return event.timestamp().rawClockSec() - battleStartRawClockSec;
    }
}
