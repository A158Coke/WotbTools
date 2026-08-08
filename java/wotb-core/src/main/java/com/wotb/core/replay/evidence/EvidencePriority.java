package com.wotb.core.replay.evidence;

/**
 * 证据优先级，用于 Prompt Evidence Planner 的入选顺序。
 * <p>由确定性规则计算（见各 Skill），不包含任何战术主观判断。</p>
 */
public enum EvidencePriority {
    CRITICAL,
    IMPORTANT,
    NORMAL
}
