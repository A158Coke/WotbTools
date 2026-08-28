package com.wotb.core.replay.facts;

/**
 * HP 观测来源种类（计划 §B4 统一 HP surface）。
 *
 * <p>base HP / observed current HP / starting actual HP 不得混成一个字段；
 * 每个 HP 事实必须标注它来自哪条权威 surface。</p>
 */
public enum HpObservationKind {
    /** Type7 propId=3 当前 HP（EXACT；含装备/物资加成）。 */
    CURRENT_HP,
    /** Type7 propId=3 阵亡归零（0）。 */
    TERMINAL_ZERO,
    /** Type7 propId=3 死亡 sentinel（0xFFFD 等，归一化为死亡）。 */
    TERMINAL_SENTINEL,
    /** Type5 combat vehicle 物化/重物化时的当前 HP 快照。 */
    MATERIALIZATION_HP,
    /** Avatar method5 录像者自身 HP 镜像（含 opening HP 种子）。 */
    RECORDER_HP_MIRROR,
    /** Vehicle method1 选中 HP 转变（currentHpRaw 与同刻 prop3 一致）。 */
    METHOD1_HP
}
