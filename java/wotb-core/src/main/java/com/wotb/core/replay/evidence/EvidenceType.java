package com.wotb.core.replay.evidence;

/**
 * Backend Evidence Skill 产出的证据类型。
 * <p>与文档 §13 首批 Skill 一一对应：Skill 只输出"发生了什么"，
 * 战术意义由 Call #2 LLM 负责。</p>
 */
public enum EvidenceType {
    HP_MOMENTUM,
    ENGAGEMENT_TRADE,
    LOCAL_SUPPORT,
    DEATH_CASCADE,
    ROUTE,
    CRITICAL_WINDOW,
    /** 单走行为候选（图控 / 拖延 / 脱节），由 TeamSoloIntentSkill / SoloPlayIntentSkill 产出。 */
    SOLO_INTENT
}
