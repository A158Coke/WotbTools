package com.wotb.core.model;

/**
 * 死亡时刻 provenance（计划 §B1/D2）。
 *
 * <p>最终 authority 链（PR147，§B1）：回放事件流 live EXACT 死亡证据（{@link #LIVE_EXACT}）
 * 优先 —— 证明可给出 sub-second precise battle-relative time，覆盖结算的秒级量化；
 * 无有效 live EXACT 时用结算死亡时刻（{@link #SETTLEMENT_SECOND}，±0.5s 量化）；
 * 两者皆无 → {@link #UNKNOWN}（{@code survivalTimeSec == 0}，绝不伪造）。</p>
 *
 * <p>EntityLeave / last position / damage threshold 等 legacy 启发式不再是死亡 authority
 * （§B2），仅存在于 LegacyReplayHeuristicDiagnostics（research/diagnostics）。</p>
 */
public enum DeathTimeSource {
    /** 结算 battle_results.dat field24 lifeTime（秒 → 死亡时刻，±0.5s 量化；非 #104 ms）。 */
    SETTLEMENT_SECOND,
    /** 回放事件流 EXACT alive=false（HP=0 / 死亡 sentinel），battle-relative 秒。 */
    LIVE_EXACT,
    /** 未知：无可用权威证据，survivalTimeSec == 0。 */
    UNKNOWN
}
