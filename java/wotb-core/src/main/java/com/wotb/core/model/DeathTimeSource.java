package com.wotb.core.model;

/**
 * 死亡时刻 provenance（计划 §B1/D2）。
 *
 * <p>最终 authority 链：结算死亡时刻（{@link #SETTLEMENT_SECOND}）优先；
 * 结算缺失时用回放 live EXACT 死亡证据（{@link #LIVE_EXACT}）填补；两者皆无 →
 * {@link #UNKNOWN}（{@code survivalTimeSec == 0}，绝不伪造）。</p>
 *
 * <p>EntityLeave / last position / damage threshold 等 legacy 启发式不再是死亡 authority
 * （§B2），仅存在于 LegacyReplayHeuristicDiagnostics（research/diagnostics）。</p>
 */
public enum DeathTimeSource {
    /** 结算 battle_results.dat deathTimeMillis（ms → /1000 秒）。 */
    SETTLEMENT_SECOND,
    /** 回放事件流 EXACT alive=false（HP=0 / 死亡 sentinel），battle-relative 秒。 */
    LIVE_EXACT,
    /** 未知：无可用权威证据，survivalTimeSec == 0。 */
    UNKNOWN
}
