package com.wotb.core.model;

/**
 * 进场满血量（entry full HP）的 provenance/置信度。
 *
 * <p>type-7 propId=3 正数只能证明「该时刻的当前 HP」；真实回放 probe（EntryHpProbeTest）
 * 显示绝大多数车辆的 positive 样本要么与首次受击同刻（受击同步、已掉血）、要么低于
 * tankopedia base——整场 max current HP 不能直接当作 actual entry full HP。</p>
 *
 * <ul>
 *   <li>{@link #OBSERVED_EXACT}：存在严格早于首次受击（或从未受击）的 positive 样本，
 *       且该样本 ≥ tankopedia base——可证明为受击前初始满血（含装备/物资加成）。</li>
 *   <li>{@link #BASE_FALLBACK}：无法证明进场满血——只允许使用 tankopedia base 作为
 *       baseline（base 是 entry 的下界），不得把 current sample 当 entry。</li>
 *   <li>{@link #UNKNOWN}：连 tankopedia base 也没有。</li>
 * </ul>
 */
public enum EntryHpSource {
    OBSERVED_EXACT,
    BASE_FALLBACK,
    UNKNOWN
}
