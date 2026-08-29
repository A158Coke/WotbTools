package com.wotb.core.replay.feature;

/**
 * 移动段派生状态。
 *
 * <p>不是 mutually-exclusive 的每 sample 分类；由段级 derived scalars 组合产出。
 * {@link #TURNING} 表示平面位移很小但车体明显转动；{@link #MOVING} 是既非前进/倒车
 * 也非明显转弯的兜底（如侧向滑移），保留真实 scalar 供 AI 自行组合。</p>
 */
public enum MovementState {
    STATIONARY,
    FORWARD,
    REVERSE,
    TURNING,
    MOVING
}
