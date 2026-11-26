package com.wotb.core.replay.evidence;

import java.util.List;

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
