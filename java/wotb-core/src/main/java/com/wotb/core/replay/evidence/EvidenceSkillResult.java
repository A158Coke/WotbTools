package com.wotb.core.replay.evidence;

import java.util.List;

/**
 * 引擎输出：全部确定性证据（不含关键窗口副本） + 关键决策窗口 + HP 动量采样序列。
 */
public record EvidenceSkillResult(
        List<AiEvidence> evidence,
        List<AiEvidence> criticalWindows,
        List<HpMomentumSkill.HpMomentumSample> momentumSeries
) {
    public EvidenceSkillResult {
        evidence = evidence == null ? List.of() : List.copyOf(evidence);
        criticalWindows = criticalWindows == null ? List.of() : List.copyOf(criticalWindows);
        momentumSeries = momentumSeries == null ? List.of() : List.copyOf(momentumSeries);
    }

    public boolean hasContent() {
        return !evidence.isEmpty() || !criticalWindows.isEmpty();
    }
}
