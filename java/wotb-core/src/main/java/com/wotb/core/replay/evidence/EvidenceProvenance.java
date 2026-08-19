package com.wotb.core.replay.evidence;

/**
 * 证据来源层级，对齐文档 §29 Authority Hierarchy：
 * Battle Result &gt; Replay deterministic event &gt; Reconstruction &gt; Backend Skill。
 */
public enum EvidenceProvenance {
    /** 来自 battle_results.dat 的权威结算（胜负、伤害、阵亡时间）。 */
    AUTHORITATIVE_SETTLEMENT,
    /** 来自 replay 确定性事件流（时间 / 位置 / interaction）。 */
    OBSERVED_EVENT_SUBSET,
    /** 来自状态重建（含 ObservationState 推断）。 */
    RECONSTRUCTION_INFERRED,
    /** 由 Backend Skill 对上述数据做的确定性派生。 */
    BACKEND_SKILL
}
