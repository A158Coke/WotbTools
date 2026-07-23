package com.wotb.core.replay.event;

/**
 * 同时保留两套时间：原始回放时钟和战斗相对时钟。
 *
 * @param rawClockSec   来自 data.wotreplay 的原始时钟，是底层事实，永远保留
 * @param battleClockSec 正式战斗开始后的相对时间（battleClockSec = rawClockSec - battleStartRawClockSec）；
 *                      无法可靠识别战斗开始事件时为 null
 */
public record ReplayTimestamp(
        float rawClockSec,
        Float battleClockSec
) {

    /**
     * 获取可用的时钟值（优先 battleClockSec，fallback rawClockSec），
     * 当 timestamp 为 null 时返回 0f。
     */
    public static float safeClockSec(final ReplayTimestamp ts) {
        if (ts == null) return 0f;
        return ts.battleClockSec() != null ? ts.battleClockSec() : ts.rawClockSec();
    }
}
