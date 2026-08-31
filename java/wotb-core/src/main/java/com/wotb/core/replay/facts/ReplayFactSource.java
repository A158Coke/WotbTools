package com.wotb.core.replay.facts;

/**
 * Replay-derived value 的 provenance / knowledge-state。
 *
 * <p>每个业务值必须能表达它来自哪里、有多确定、是否真的被观察到、是否只是派生、
 * 是否来自结算、是否未知——而不是每个字段都硬塞一个值。</p>
 */
public enum ReplayFactSource {
    /** 事件流精确观测（EXACT 解码；如 Type7 propId=3 / Type5 物化 HP 快照）。 */
    OBSERVED_EXACT,
    /** 由观测派生（如速度/角速度来自连续 Type10 采样）。 */
    DERIVED_FROM_OBSERVED,
    /** 结算精确值（battle_results.dat 精确字段）。 */
    SETTLEMENT_EXACT,
    /** tankopedia / 静态参考基线（不是本场实际值）。 */
    BASE_REFERENCE,
    /** 未知。 */
    UNKNOWN
}
