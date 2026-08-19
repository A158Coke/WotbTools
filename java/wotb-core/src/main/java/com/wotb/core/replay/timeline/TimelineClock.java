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
        // timestamp 为 null → NaN（invalid）：调用方必须过滤/计数，绝不把缺失时间戳塞进 frame 0
        if (event.timestamp() == null) {
            return Double.NaN;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        return event.timestamp().rawClockSec() - battleStartRawClockSec;
    }

    /**
     * 时钟域一致性：仅当「非 null timestamp 的事件」全部携带 battleClockSec（或全部不携带）
     * 时才一致；混合域（部分带 battleClockSec、部分 raw-only）会导致两个时钟域混用，
     * 调用方应拒绝用 0 基准并走 raw 域统一（ESTIMATED）。
     */
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
