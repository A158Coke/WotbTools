package com.wotb.core.replay.timeline;

import java.util.List;

/**
 * 战术章节：整场战斗的连续划分（docs/architecture/battle-timeline.md §21/§22/§24）。
 * <p>Episode 覆盖整场、连续、无重叠；Episode 与 Critical Window 严格区分——
 * Window 是分析局部战术问题的观察窗口，可跨 Episode、可重叠。</p>
 */
public record TacticalEpisode(
        int index,
        double startSec,
        double endSec,
        WorldSummary before,
        WorldSummary after,
        List<BattleDelta> deltas,
        List<String> tacticalChanges,
        List<String> limitations
) {
    public double durationSec() {
        return endSec - startSec;
    }
}
