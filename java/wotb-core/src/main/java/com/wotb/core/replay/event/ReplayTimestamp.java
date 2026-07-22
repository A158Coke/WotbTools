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
}
