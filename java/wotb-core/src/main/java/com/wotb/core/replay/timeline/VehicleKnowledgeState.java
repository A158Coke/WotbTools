package com.wotb.core.replay.timeline;

/**
 * 敌方车辆知识状态（保守语义）。
 * <p>Type-5 精确点亮语义尚未正式证明（docs/research/replay/visibility.md 门禁 A = PARTIAL），
 * 因此不声称 SPOTTED/UNSPOTTED；位置流状态只表达「服务器位置流覆盖」，
 * 与录像者可见性无关（type-10 与点亮无关，见 docs/research/replay/protocol.md）。</p>
 */
public enum VehicleKnowledgeState {
    /**
     * 位置流当前活跃（服务器持续广播位置）：位置即当前已知位置
     */
    POSITION_STREAM_ACTIVE,
    /**
     * 位置流已中断（gap 超过阈值）：仅保留最后已知位置 + age
     */
    LAST_KNOWN,
    /**
     * 从未观测到位置（敌方静止或尚未进入位置流）
     */
    UNKNOWN,
    /**
     * 当时已确知阵亡（battle-relative 事件在 t 之前可靠证明）
     */
    DESTROYED_KNOWN
}
