package com.wotb.core.replay.evidence;

/**
 * Backend Evidence Skill 产出的证据类型。
 * <p>与文档 §13 首批 Skill 一一对应：Skill 只输出"发生了什么"，
 * 战术意义由 Call #2 LLM 负责。</p>
 * <p><b>Backend Evidence Boundary（PR #103 架构收口）</b>：Backend Evidence MUST represent
 * observed facts / deterministic derived measurements / neutral structural classifications；
 * Backend Evidence MUST NOT encode player intent、tactical correctness、tactical benefit、
 * tactical blame 或 recommendation。战术解释（拖延/脱节/图控/交换是否值得等）全部由 LLM 基于
 * 多个事实自行判断。</p>
 */
public enum EvidenceType {
    HP_MOMENTUM,
    ENGAGEMENT_TRADE,
    LOCAL_SUPPORT,
    DEATH_CASCADE,
    ROUTE,
    CRITICAL_WINDOW,
    /**
     * 空间分离证据：某成员与主要友军集群保持距离的结构事实（中性；无 intent 语义）。
     * 由 TeamSeparationEvidenceSkill / PlayerSeparationEvidenceSkill 产出；
     * 是否构成拖延/脱节/有效牵制由 LLM 判断。
     */
    SPATIAL_SEPARATION
}
